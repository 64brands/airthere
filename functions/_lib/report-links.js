const CANONICAL_ORIGIN = "https://airthere.com.au";

export const shootViewPath = ({ slug, projectCode, shootDate }) =>
  `/${slug}/${projectCode}/${shootDate}`;

export const imageViewPath = ({ slug, projectCode, shootDate, imageId }) =>
  `${shootViewPath({ slug, projectCode, shootDate })}#image-${imageId}`;

export const publicOrigin = (origin) => {
  const host = String(origin || CANONICAL_ORIGIN).replace(/\/$/, "");
  return host.startsWith("http") ? host : `https://${host}`;
};

export const imageViewUrl = ({
  origin = CANONICAL_ORIGIN,
  slug,
  projectCode,
  shootDate,
  imageId,
}) => `${publicOrigin(origin)}${imageViewPath({ slug, projectCode, shootDate, imageId })}`;

export const shareImageViewPath = ({ token, imageId }) =>
  `/share/${token}/image/${imageId}`;

export const shareImageViewUrl = ({ origin = CANONICAL_ORIGIN, token, imageId }) =>
  `${publicOrigin(origin)}${shareImageViewPath({ token, imageId })}`;
