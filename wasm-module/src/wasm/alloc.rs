//! The global allocator: dlmalloc, like the standard library's, but growing
//! WebAssembly memory in larger steps.
//!
//! The standard allocator grows memory by just what each new segment needs,
//! often a single 64 KB page. Each `memory.grow` costs about 0.13 ms in V8
//! whatever the size, so when thousands of requests are pending at once
//! (overload), growth by hundreds of megabytes took most of the CPU. Growing
//! by an eighth of the current size, and at least 1 MB, needs a few dozen
//! grows instead of thousands. Memory is never returned either way.

use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32::{memory_grow, memory_size};
use core::cell::UnsafeCell;
use dlmalloc::{Allocator as SystemAllocator, Dlmalloc};

const PAGE: usize = 64 * 1024;
const MIN_STEP: usize = 1024 * 1024;

/// Grows memory like dlmalloc's own wasm `System`, by more than requested
struct GrowInSteps;

impl GrowInSteps {
    fn grow(size: usize) -> Option<(*mut u8, usize, u32)> {
        let pages = size.div_ceil(PAGE);
        let previous = memory_grow(0, pages);
        (previous != usize::MAX).then(|| ((previous * PAGE) as *mut u8, pages * PAGE, 0))
    }
}

unsafe impl SystemAllocator for GrowInSteps {
    fn alloc(&self, size: usize) -> (*mut u8, usize, u32) {
        let step = size.max(memory_size(0) * PAGE / 8).max(MIN_STEP);
        // Near the 4 GB limit, settle for what was needed
        Self::grow(step)
            .or_else(|| Self::grow(size))
            .unwrap_or((core::ptr::null_mut(), 0, 0))
    }

    fn remap(&self, _ptr: *mut u8, _old: usize, _new: usize, _can_move: bool) -> *mut u8 {
        core::ptr::null_mut()
    }

    fn free_part(&self, _ptr: *mut u8, _old: usize, _new: usize) -> bool {
        false
    }

    fn free(&self, _ptr: *mut u8, _size: usize) -> bool {
        false
    }

    fn can_release_part(&self, _flags: u32) -> bool {
        false
    }

    fn allocates_zeros(&self) -> bool {
        true
    }

    fn page_size(&self) -> usize {
        PAGE
    }
}

struct Allocator(UnsafeCell<Dlmalloc<GrowInSteps>>);

// The module is single-threaded (no shared memory), so there's no contention
unsafe impl Sync for Allocator {}

unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        (*self.0.get()).malloc(layout.size(), layout.align())
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        (*self.0.get()).calloc(layout.size(), layout.align())
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        (*self.0.get()).free(ptr, layout.size(), layout.align());
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        (*self.0.get()).realloc(ptr, layout.size(), layout.align(), new_size)
    }
}

#[global_allocator]
static ALLOCATOR: Allocator = Allocator(UnsafeCell::new(Dlmalloc::new_with_allocator(GrowInSteps)));
