import {
  IMAGE_VARIANT_FORMATS,
  IMAGE_VARIANT_WIDTHS,
  isVectorExt,
  type ImageMetadata,
} from "@/lib/image-types";

type Props = {
  image: ImageMetadata;
  /** Hint to the browser for sizing. Default: 100vw. */
  sizes?: string;
  className?: string;
};

function variantPath(image: ImageMetadata, width: number, format: string): string {
  return `/images/${image.contentSlug}/${image.id}/${width}.${format}`;
}

function originalPath(image: ImageMetadata): string {
  return `/images/${image.contentSlug}/${image.id}/original.${image.originalExt}`;
}

function srcSetForFormat(image: ImageMetadata, format: string): string {
  return IMAGE_VARIANT_WIDTHS.filter((w) => w <= image.width)
    .map((w) => `${variantPath(image, w, format)} ${w}w`)
    .join(", ");
}

export function Image({ image, sizes = "100vw", className }: Props) {
  // Vector / icon formats bypass the sharp variant pipeline — no
  // sized webp/avif files exist. Render the original directly; SVG /
  // ICO are scalable so the browser picks the right resolution
  // without `<picture>` srcSet help. Skip the LQIP placeholder too —
  // vectors paint instantly anyway. The `<picture>` wrapper has no
  // `<source>` children; it's there so Next's `no-img-element` lint
  // rule (which exempts `<img>` inside `<picture>`) stays happy.
  if (isVectorExt(image.originalExt)) {
    return (
      <picture>
        <img
          src={originalPath(image)}
          alt={image.alt}
          loading="lazy"
          decoding="async"
          className={className}
        />
      </picture>
    );
  }

  const fallback = `${variantPath(image, Math.min(800, image.width), "webp")}`;

  return (
    <picture>
      {IMAGE_VARIANT_FORMATS.map((format) => (
        <source
          key={format}
          type={`image/${format}`}
          srcSet={srcSetForFormat(image, format)}
          sizes={sizes}
        />
      ))}
      <img
        src={fallback}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        className={className}
        style={{
          backgroundImage: `url(${image.placeholderDataUri})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
    </picture>
  );
}
