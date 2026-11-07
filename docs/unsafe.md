# Unsafe code

All hand-written `unsafe` in this repository, and what each use relies on. Both crates deny it (`#![deny(unsafe_code)]`), so the compiler rejects any new use unless someone allows it on purpose. `node scripts/check-unsafe.mjs` runs in CI and fails when an `unsafe` keyword appears in a file that is not listed here, or when the count in a listed file changes.

## Inventory

| File | `unsafe` | Why |
| --- | --- | --- |
| `wasm-module/src/wasm/alloc.rs` | 7 (`unsafe impl SystemAllocator`, `unsafe impl Sync`, `unsafe impl GlobalAlloc`, and its four `unsafe fn`) | The Wasm global allocator: dlmalloc that grows memory in larger steps |
| `native/` | 0 | The `#[napi]` macros expand to unsafe code of their own. They allow it inside their expansions, which is why the crate uses `deny` and not `forbid` |
| everything else in `wasm-module/` | 0 | |

### `wasm-module/src/wasm/alloc.rs`

**`unsafe impl SystemAllocator for GrowInSteps`.** dlmalloc's trait is `unsafe` because dlmalloc trusts what it returns. The invariants:
- `alloc` returns a region obtained from `memory.grow`, so it is fresh, writable, not used by anything else, a multiple of the 64 KiB page, and zero filled, which is what `allocates_zeros() == true` promises. On failure it returns a null pointer with size 0, which dlmalloc treats as out of memory.
- `remap`, `free_part` and `free` return failure and `can_release_part` returns false, so dlmalloc never believes memory went back to the system. Wasm memory cannot shrink.
- `page_size` is 64 KiB, the size of a Wasm page.

**`unsafe impl Sync for Allocator`.** `Allocator` wraps an `UnsafeCell<Dlmalloc>`, which is not `Sync`. This is sound only while one thread uses the module. The build has no shared memory and no `atomics` target feature, and a build that enables `atomics` fails with a `compile_error!` so that the assumption cannot be broken silently.

**`unsafe impl GlobalAlloc for Allocator` and its four `unsafe fn`.** Each one dereferences `self.0.get()` to get a `&mut Dlmalloc`. That is sound when no other reference to the same `Dlmalloc` is live:
- one thread only (above);
- no re-entrancy: dlmalloc does not call the global allocator, and `GrowInSteps` only calls the `memory.grow` and `memory.size` intrinsics and does not allocate;
- `Layout` size and alignment are passed through unchanged, and callers uphold the `GlobalAlloc` contract (a pointer from `alloc` with the same layout goes to `dealloc` and `realloc`).

## Not covered yet

- **Miri and AddressSanitizer** run in `.github/workflows/memory-safety.yml`. Miri interprets the unit tests of the budget, circuit breaker, idempotency, limiter, line and SSE parsers, timeouts, URL, error and type modules (53 tests, strict provenance, symbolic alignment check) and skips three it cannot judge: one builds a TLS client whose backend is C code, two assert on 20 ms deadlines that pass while the interpreter is still running. AddressSanitizer runs the whole host test suite of the Rust crate, dependencies included. Neither covers the Wasm allocator above, the native addon (`native/`, exercised only through the JavaScript tests, without a sanitizer) or the JavaScript/Wasm boundary.
- **Dependencies.** This list is the code in this repository. `cargo geiger` or `cargo vet` output for the dependency tree (hyper, rustls, ring, dlmalloc, napi and the rest) is not part of CI.
