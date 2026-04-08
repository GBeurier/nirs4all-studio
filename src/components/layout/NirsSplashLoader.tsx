import nirsOscLoaderMarkup from "@/assets/nirs-osc-loader.svg?raw";

type NirsSplashLoaderProps = {
  className?: string;
  alt?: string;
};

export function NirsSplashLoader({ className, alt = "NIRS loading animation" }: NirsSplashLoaderProps) {
  const svgMarkup = nirsOscLoaderMarkup
    .replace('role="img"', 'aria-hidden="true"')
    .replace(/aria-label="[^"]*"/, "");

  return (
    <div
      role="img"
      aria-label={alt}
      className={`pointer-events-none select-none [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className ?? ""}`.trim()}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}
