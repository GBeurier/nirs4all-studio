import nirsOscLoader from "@/assets/nirs-osc-loader.svg";

type NirsSplashLoaderProps = {
  className?: string;
  alt?: string;
};

export function NirsSplashLoader({ className, alt = "NIRS loading animation" }: NirsSplashLoaderProps) {
  return (
    <img
      src={nirsOscLoader}
      alt={alt}
      draggable={false}
      className={`pointer-events-none select-none ${className ?? ""}`.trim()}
    />
  );
}
