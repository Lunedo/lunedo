import { Avatar } from "@lunedo/ui";

export function accountPictureUrl(
  accountId: string,
  pictureRef: string | null | undefined,
): string | undefined {
  if (!pictureRef) return undefined;
  return `/api/v1/accounts/${encodeURIComponent(accountId)}/picture?v=${encodeURIComponent(pictureRef)}`;
}

export function PersonAvatar({
  id,
  name,
  pictureRef,
  size,
  decorative,
}: {
  id: string | null | undefined;
  name: string;
  pictureRef?: string | null | undefined;
  size?: "sm" | "md" | "lg";
  decorative?: boolean;
}) {
  const src = id ? accountPictureUrl(id, pictureRef) : undefined;
  return (
    <Avatar
      name={name}
      {...(src ? { src } : {})}
      {...(size ? { size } : {})}
      {...(decorative ? { decorative } : {})}
    />
  );
}
