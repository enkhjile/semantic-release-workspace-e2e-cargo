pub fn value() -> u32 { 42 }
#[test] fn core_value() { assert_eq!(value(), 42); }

pub fn cycle_marker() -> u32 { 8 }
