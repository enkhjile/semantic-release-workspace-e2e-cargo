pub fn value() -> u32 { 42 }
#[test] fn core_value() { assert_eq!(value(), 42); }

pub fn shared_release_ready() -> bool { true }
#[test] fn shared_release_capability() { assert!(shared_release_ready()); }

pub fn independent_release_ready() -> bool { true }
#[test] fn independent_release_capability() { assert!(independent_release_ready()); }
