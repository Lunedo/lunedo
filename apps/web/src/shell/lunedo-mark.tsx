import black from "../assets/logo/lunedo-mark-black.svg";
import petrol from "../assets/logo/lunedo-mark-petrol.svg";
import white from "../assets/logo/lunedo-mark-white.svg";
import "../assets/logo/logo.css";

export function LunedoMark({ className = "" }: { className?: string }) {
  return (
    <span className={`lunedo-mark ${className}`.trim()} aria-hidden="true">
      <img src={petrol} alt="" data-variant="petrol" />
      <img src={black} alt="" data-variant="black" />
      <img src={white} alt="" data-variant="white" />
    </span>
  );
}
