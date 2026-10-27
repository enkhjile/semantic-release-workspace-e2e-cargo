pub fn value() -> u32 { enkhjile_srw_e2e_core::value() }
#[test] fn adapter_value() { assert_eq!(value(), 42); }

// Adapter-only alpha.4 intent consumes the existing published core unchanged.

pub const ALPHA6_BASELINE: bool = true;
