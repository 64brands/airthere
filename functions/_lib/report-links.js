const CANONICAL_ORIGIN = "https://airthere.com.au";

export const shootViewPath = ({ slug, projectCode, shootDate }) =>
  `/${slug}/${projectCode}/${shootDate}`;

export const imageViewPath = ({ slug, projectCode, shootDate, imageId }) =>
  `${shootViewPath({ slug, projectCode, shootDate })}#image-${imageId}`;

export const imageViewUrl = ({
  origin = CANONICAL_ORIGIN,
  slug,
  projectCode,
  shootDate,
  imageId,
}) => {
  const host = String(origin || CANONICAL_ORIGIN).replace(/\/$/, "");
  const base = host.startsWith("http") ? host : `https://${host}`;
  return `${base}${imageViewPath({ slug, projectCode, shootDate, imageId })}`;
};
