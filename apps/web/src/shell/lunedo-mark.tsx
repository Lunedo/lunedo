import light from "../assets/logo/lunedo-mark.svg";
import dark from "../assets/logo/lunedo-mark-dark.svg";
import monoBlack from "../assets/logo/lunedo-mark-mono-black.svg";
import monoWhite from "../assets/logo/lunedo-mark-mono-white.svg";
import "../assets/logo/logo.css";

export function LunedoMark({ className = "" }: { className?: string }) {
  return (
    <span className={`lunedo-mark ${className}`.trim()} aria-hidden="true">
      <img src={light} alt="" data-variant="light" />
      <img src={dark} alt="" data-variant="dark" />
      <img src={monoBlack} alt="" data-variant="mono-black" />
      <img src={monoWhite} alt="" data-variant="mono-white" />
    </span>
  );
}
