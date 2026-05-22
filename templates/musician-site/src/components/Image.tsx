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
  /**
   * When true, opt the image out of lazy loading so above-the-fold
   * uses (hero sections, the first slide of a carousel, page headers)
   * paint immediately. Defaults to false — lazy loading is the right
   * choice for everything below the first viewport, which is the
   * dominant case.
   */
  isPriority?: boolean;
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

export function Image({
  image,
  sizes = "100vw",
  className,
  isPriority = false,
}: Props) {
  const loading = isPriority ? "eager" : "lazy";
  // `fetchpriority="high"` reinforces the loading hint for priority
  // images — the spec-blessed way to tell the browser "preload this
  // one." React 19 surfaces the attribute as `fetchPriority`.
  const fetchPriority = isPriority ? "high" : undefined;
  // Vector / icon formats bypass the sharp variant pipeline — no
  // sized webp/avif files exist. Render the original directly; SVG /
  // ICO are scalable so the browser picks the right resolution
  // without `<picture>` srcSet help. Skip the LQIP placeholder too —
  // vectors paint instantly anyway.
  //
  // Width / height are forwarded from the metadata (nominal
  // 1024×1024 for vectors) so the browser reserves layout space
  // before the image paints — without them, content reflows on slow
  // SVG loads. CSS sizing (`max-width: 100%` etc.) still drives the
  // visible dimensions; these attributes only fix the aspect ratio
  // reservation.
  //
  // `<img>` rather than Next's `<Image>` because the bypass is
  // explicit about the no-variant case; an eslint-disable is
  // targeted and the rationale is right here.
  if (isVectorExt(image.originalExt)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={originalPath(image)}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading={loading}
        fetchPriority={fetchPriority}
        decoding="async"
        className={className}
      />
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
        loading={loading}
        fetchPriority={fetchPriority}
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
