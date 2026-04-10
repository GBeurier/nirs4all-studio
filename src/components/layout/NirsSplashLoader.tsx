import { memo } from "react";
import nirsOscLoaderMarkup from "@/assets/nirs-osc-loader.svg?raw";

type NirsSplashLoaderProps = {
  className?: string;
  alt?: string;
};

const loaderAnimationOverrides = `
    .reduce-motion .nirs-splash-loader .frame-grid line {
      animation: gridPulse 3.2s ease-in-out infinite !important;
    }

    .reduce-motion .nirs-splash-loader .spectrum-glow {
      animation: spectrumPulse 2.8s ease-in-out infinite !important;
    }

    .reduce-motion .nirs-splash-loader .spectrum-main {
      animation: spectrumTrace 6.8s cubic-bezier(0.4, 0, 0.2, 1) infinite !important;
    }

    .reduce-motion .nirs-splash-loader .network-layer {
      animation: networkBuild 6.8s linear infinite !important;
    }

    .reduce-motion .nirs-splash-loader .network-edge {
      animation: edgeBuild 6.8s cubic-bezier(0.22, 1, 0.36, 1) infinite !important;
    }

    .reduce-motion .nirs-splash-loader .network-node {
      animation: nodeBuild 6.8s linear infinite !important;
    }

    .reduce-motion .nirs-splash-loader .signal-particle {
      animation: particleBlink 1.1s ease-in-out infinite !important;
    }
`;

const svgMarkup = nirsOscLoaderMarkup
  .replace("<svg", '<svg class="nirs-splash-loader"')
  .replace('role="img"', 'aria-hidden="true" focusable="false"')
  .replace(/aria-label="[^"]*"/, "")
  .replace("</style>", `${loaderAnimationOverrides}\n  </style>`);

const loaderMarkup = { __html: svgMarkup };

export const NirsSplashLoader = memo(function NirsSplashLoader({
  className,
  alt = "NIRS loading animation",
}: NirsSplashLoaderProps) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={`pointer-events-none select-none [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className ?? ""}`.trim()}
      dangerouslySetInnerHTML={loaderMarkup}
    />
  );
});
