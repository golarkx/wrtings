---
title: "Grokking AI on K8"
description: "Configuring Kubernetes to run LLM workloads"
pubDate: 2026-10-14
tags: ["writing", "process"]
---
## Grokking AI on Kubernetes

Running AI workloads on Kubernetes introduces a paradigm shift when compared to deploying web apps; Infrastructure needs to be configured with a different mental model to avoid silent cost explosions, 3am pages or underutilising precious GPU compute.

## The Paradigm Shift

Every developer who has deployed a web app to production has an intuition for how software runs on a kubernetes cluster:

- Keep a small container image, make it immutable & reproducible
- Pods come and go, if one does another pops up
- Offload state management to Redis, Postgres, or Object storage
- Controller scales objects horizontally by adding more replicas, which means more CPU
- Requests complete in tens of milliseconds, concurrency is almost free
- Cold start is in milliseconds, rollouts are simple

This model is simple and beautiful but it is *not the right mental model* for large language model workloads and configuring this way surely will lead to failure in production in form of cost explosion, underutilized resources and the dreaded 3am pages. A 70B model quantized to 4-bit requies 40GB of VRAM for the lifetime of the process, you can't just treat the deployment as fire and forget but instead must manage the state, symphetize with the hardware, and handle latency sensitive workloads. 

The core mistake is assuming Kubernetes's resource model is universal. It isn't. Kubernetes's scheduler was designed around one idea: **CPU and memory are fungible and divisible**. Give me 500 millicores and 2Gi of RAM and I will find you a home, packing you alongside a dozen other tenants onto a node because everyone is asking for slices of the same pie. A GPU is not a slice of that pie. It is a discrete, expensive, non-divisible device with its own memory hierarchy and its own driver state. As a result, you *can't simply ask the controller for "some of a GPU".

So let's name the three places where the web-app model collides with reality. Every section that follows is a direct consequence of one of them.

---

### Clash #1 — Compute: GPUs Are Not CPUs (and Not Divisible)

The CPU abstraction in Kubernetes is genuinely simple; `requests.cpu: 500m` means "half a core of guaranteed capacity." The scheduler runs a bin-packing algorithm, carves the node into slices, and hands them out. Memory works the same way: bytes, fungible, divisible.

A GPU breaks this in three separate ways:

1. **Compute units are non-fungible** NVIDIA GPUs expose Streaming Multiprocessorts (SMs), a block scheduler then assigns thread blocks to available SMs. These can be time-sliced across multiple processes which use the same silicon however they must contend on memory bandwidth. There is a no concept of a 200 millicores of a GPU - thats just meaningless to a CUDA kernel
2. **Memory is physically attached to the device.** An A100's 80GB of HBM is not host RAM. It lives on the card, behind the PCIe/NVLink fabric, and it is invisible to the Kubernetes scheduler. A workload that allocates 70GB of KV cache on an 80GB card has a hard ceiling that no amount of CPU request can move.
3. **The allocation unit is the whole device by default.** When a pod requests `nvidia.com/gpu: 1`, it gets *the entire GPU*, all 80GB of HBM included. There is no meaningful fractional resource until you explicitly configure the device plugin for MIG (Multi-Instance GPU) to expose hardware-level partitions, or enable time-slicing to oversubscribe the same device across processes.

The second consequence is **placement**. Because a pod doesn't "own" a GPU — it owns a *device handle* on a *node* that has GPUs — the scheduler's job changes from "bin-pack a fraction" to "pick the right machine." A logging sidecar, a metrics exporter, or a default `ClusterIP` service mesh proxy will happily land on your A100 node, because it asked for 100m of CPU and some bytes of RAM, and the GPU sitting there is invisible to it. Your $3/hour GPU is now partly serving a DaemonSet.

This answers the question; "the cluster looks fine but the GPU is always busy and we don't know why."

---

### Clash #2 — Weight: Tens of Gigabytes of Immovable State

"Stateless" is the load-bearing word in every web app architecture diagram. LLM serving is stateful in three concentric layers, and each one has different consequences:

**Layer 1 — The weights (~40GB).** Immutable, huge, and *required to be inside high bandwidth memory at all times*. They are also the artifact you must move across the network every time a pod starts.

- **Baking them into the image** sounds like the simple answer. It is the wrong one. A 40GB+ image turns every rollout into a multi-minute pull on every node, multiplies registry storage and egress costs, and guarantees that your cluster's image pull bandwidth becomes the bottleneck during a scale event. Worse, the registry is now a *per-model artifact store*, which is the wrong tool.
- **Pulling at startup** is better but still wrong. It means the pod's readiness is gated on network throughput to a registry, and a scale-out event from 3 to 30 replicas means 30 concurrent pulls of the same 40GB from the same origin. This is a textbook thundering herd, and it is why "scale fast" and "scale out" are not the same thing in AI workloads.
- **Caching once per node** (via an init container writing to a `hostPath`, or a node-local PV, or a DaemonSet-managed cache) is usually the correct answer: one pull per node, N pods per node reuse it. Now the *node* is the unit of weight residency, not the pod.

**Layer 2 — The load process (minutes, not milliseconds).** Even with the bytes on local disk, loading is not `memcpy`. You must deserialize weights into VRAM, allocate the KV cache pool, initialize CUDA graphs, load a compiled model (vLLM's torch.compile, TensorRT-LLM's engine build), and run a warmup pass to stabilize kernel autotuning and batch scheduling. A 40GB load off NVMe is fast; a *usable* server is not. Typical cold start: 30 seconds to 10 minutes depending on model, precision, and compilation strategy. Every health probe, timeout, and rollout strategy you know from web apps has to be re-derived for this window.

**Layer 3 — Runtime caches (GBs, per replica).** The KV cache (attention keys/values for every in-flight sequence), prefix caches (vLLM's block-level prefix reuse, SGLang's radix cache), and continuous-batching state live in GPU memory and are *not* portable between replicas. So "scale horizontally" does not preserve your cache hit rate: a new replica starts cold, and a request routed to it pays full prefill cost. Scale-out is expensive twice — once in GPUs, once in lost cache warmth.

And then there is the case where the model doesn't fit on one card at all. At 70B in BF16 (~140GB), a single A100 80GB cannot hold it. You now need tensor parallelism, pipeline parallelism, or expert parallelism — which means **one logical model is now a coordinated group of pods that must land on the same node (or be wired over NVLink) and fail together**. The unit of deployment stops being "a pod" and starts being "a shard group," and the "deploy N identical replicas" model of Kubernetes has to be rethought as a gang-scheduled workload.

---

### Clash #3 — Traffic: Long-Running, Bursty, and Bounded by Memory

A Node.js handler serves thousands of concurrent requests, each taking milliseconds. An LLM request is an entirely different animal:

**Time.** A single response is a *decode loop* — one token at a time, 20–100 tokens/second depending on model size and hardware. A 500-token answer at 40 tok/s is 12.5 seconds. A 4,000-token answer is 100 seconds. An agentic workload with tool calls multiplies that. On top of that sits **prefill** — ingesting your prompt, which for long-context or RAG-heavy traffic (100k+ tokens) can be tens of seconds on its own. Total request latency routinely lands in the 10s–120s range, and it is *streaming*, so the connection is held open the whole time.

**Concurrency.** The limit on how many requests you can serve concurrently is **not** CPU, and it is **not** connection count — it is **KV cache memory**, which scales linearly with `batch_size × sequence_length`. The arithmetic is brutal: for Llama-3-70B (80 layers, 64 KV heads, head_dim 128, FP16), the KV cache costs ~2.5 MiB **per token**. A single 8k-token sequence needs ~20GB of HBM. On an 80GB A100 holding the model itself, you can fit perhaps *three or four* such sequences concurrently. The server can be at 100% "GPU utilization" serving 3 requests or 100 requests — the metric tells you almost nothing.

**The timeout cliff.** This is where the two worlds collide most violently. Your infrastructure is full of defaults tuned for millisecond responses:

| Layer | Default timeout | Effect on a 90s generation |
|---|---|---|
| nginx `proxy_read_timeout` | 60s | 504 at 60s, GPU keeps generating |
| Envoy route timeout | 15s | request killed mid-stream |
| Kubernetes Ingress / Istio `VirtualService` | varies, often unset or short | dropped connection, wasted tokens |
| Cloud LBs (ALB, GCP, Azure) | 60s | client sees 504, server sees success |

The result is the worst possible outcome: the GPU burns tokens on work nobody will read, the client gets an error, and your error rate is 100% while your GPU utilization looks *perfect*.

**Traffic shape.** AI traffic is not a smooth CPU-bound curve. It is bursty and queue-driven: a burst arrives, a queue forms, GPUs drain it at a fixed rate. The correct scaling unit is **replicas** (more hardware), not **concurrency** (more threads on one GPU), and the correct scaling *signal* is **queue depth**, not CPU%. Autoscaling on CPU% for LLM serving is measuring the wrong physical quantity. Event driven autoscaling is a must here. 

**Cancellation semantics.** When a client disconnects at 47 seconds, does the GPU stop? If not, you are burning money on tokens that go nowhere. Correct behavior requires the server to observe the disconnect and abort the request (vLLM's abortable requests), and requires your retry logic at the gateway to understand that a retry may duplicate work.

---

### The Mental Model Shift

| Dimension | Node.js Web App | LLM Inference Server |
|---|---|---|
| Deployment unit | Pod = interchangeable replica | Pod = replica that owns VRAM + caches |
| Resource model | CPU/memory: fungible, divisible | GPU: indivisible device, attached memory |
| Cold start | ~1 second | 30s – 10 min (load + warmup + compile) |
| Request duration | 10–100 ms | 10s – 120s (streaming) |
| Concurrency limit | Event loop / connections | KV cache memory |
| Scaling signal | CPU%, RPS | Queue depth, pending requests, KV cache use |
| Scale-out cost | ~Free (small pods) | New GPU node ($2–4+/hour, minutes to boot) |
| State | None (session in Redis) | Weights (GB), KV cache (GB), batch state |
| Failure unit | One pod dies | Node/GPU loss kills a whole shard |
| Routing | Any replica is identical | Replica affinity matters (cache warmth, shard group) |

---

### The Three Pillars

Everything in this article leads to;

1. **Configure Kubernetes to understand hardware** — teach the scheduler what a GPU is, where it is, and what must not touch it (taints, tolerations, affinity, device plugins, MIG).
2. **Separate state from lifecycle** — never let the pod's start/stop own the weights; make loading explicit, cacheable per node, and observable.
3. **Scale on the right signal** — model the workload as a queue, not a CPU graph; scale on backlog, and protect long-running requests with timeouts and cancellation that match reality.

