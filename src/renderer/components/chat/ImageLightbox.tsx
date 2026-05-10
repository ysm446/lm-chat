import { useEffect } from "react";

interface Props {
  src: string;
  onClose: () => void;
}

export function ImageLightbox({ src, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="image-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label="画像の拡大表示">
      <button type="button" className="image-lightbox-close" onClick={onClose} aria-label="閉じる">×</button>
      <img src={src} alt="拡大画像" className="image-lightbox-content" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
