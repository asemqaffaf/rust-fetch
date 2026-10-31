#![no_main]
use libfuzzer_sys::fuzz_target;
fuzz_target!(|data: &[u8]| rust_fetch::fuzzing::fuzz_lines(data));
