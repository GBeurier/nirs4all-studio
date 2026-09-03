fn main() {
    println!("cargo:rustc-check-cfg=cfg(nirs4all_archive_v2_source_consumer)");
    println!("cargo:rustc-cfg=nirs4all_archive_v2_source_consumer");
}
