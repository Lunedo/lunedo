import type { HocuspocusProvider } from "@hocuspocus/provider";
import { initialsOf, Tooltip } from "@lunedo/ui";
import type { Editor } from "@tiptap/core";
import { relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { PersonAvatar } from "../components/person-avatar.js";

export const presenceColors = ["petrol", "blue", "violet", "amber", "red", "green"] as const;
export type PresenceColor = (typeof presenceColors)[number];

export interface PresenceUser {
  id: string;
  name: string;
  color: PresenceColor;
}

export function presenceColor(accountId: string): PresenceColor {
  let hash = 0;
  for (const character of accountId) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return presenceColors[hash % presenceColors.length] ?? "petrol";
}

export function cursorColor(accountId: string): string {
  let hash = 0;
  for (let index = 0; index < accountId.length; index += 1) {
    hash = ((hash << 5) - hash + accountId.charCodeAt(index)) | 0;
  }
  return `hsl(${(Math.abs(hash) % 37) * 10}, 100%, 83%)`;
}

type PresenceAwareness = Pick<
  Awareness,
  "clientID" | "getStates" | "getLocalState" | "setLocalStateField" | "on" | "off"
>;

function isPresenceColor(value: unknown): value is PresenceColor {
  return presenceColors.includes(value as PresenceColor);
}

export function publishedColor(user: unknown): PresenceColor {
  const published = user as { id?: unknown; presence?: unknown } | undefined;
  if (isPresenceColor(published?.presence)) return published.presence;
  return typeof published?.id === "string" && published.id !== "" ? presenceColor(published.id) : "petrol";
}

export function choosePresenceColor(
  awareness: PresenceAwareness,
  accountId: string,
  current: PresenceColor,
  joining: boolean,
): PresenceColor {
  const others: { clientId: number; color: PresenceColor }[] = [];
  awareness.getStates().forEach((state, clientId) => {
    const user = state.user as { id?: unknown; presence?: unknown } | undefined;
    if (clientId === awareness.clientID || !user?.id || user.id === accountId) return;
    if (isPresenceColor(user.presence)) others.push({ clientId, color: user.presence });
  });
  const taken = (color: PresenceColor) => others.some((other) => other.color === color);
  const conflict = joining
    ? taken(current)
    : others.some((other) => other.color === current && other.clientId < awareness.clientID);
  if (!conflict) return current;
  return presenceColors.find((color) => !taken(color)) ?? current;
}

export function claimPresenceColor(
  awareness: PresenceAwareness,
  user: { id: string; name: string },
  onChange: (color: PresenceColor) => void = () => {},
): () => void {
  const previous = (awareness.getLocalState()?.user as { presence?: unknown } | undefined)?.presence;
  let color = isPresenceColor(previous) ? previous : presenceColor(user.id);
  let joining = true;
  const update = () => {
    const next = choosePresenceColor(awareness, user.id, color, joining);
    joining = false;
    const local = awareness.getLocalState()?.user as Record<string, unknown> | undefined;
    if (next === color && local?.presence === color) return;
    color = next;
    awareness.setLocalStateField("user", { ...local, id: user.id, name: user.name, color, presence: color });
    onChange(color);
  };
  update();
  awareness.on("change", update);
  return () => awareness.off("change", update);
}

export function usePresenceColor(
  provider: HocuspocusProvider | null,
  self: { id: string; name: string } | null,
  synced: boolean,
): PresenceColor | null {
  const [color, setColor] = useState<PresenceColor | null>(null);
  const id = self?.id;
  const name = self?.name;
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness || !id || name === undefined || !synced) return;
    return claimPresenceColor(awareness, { id, name }, setColor);
  }, [provider, id, name, synced]);
  return color;
}

export function selectionAttributes(user: Record<string, unknown>) {
  return { class: "ld-remote-selection", "data-color": publishedColor(user) };
}

export function hiddenCaret(): HTMLElement {
  const element = document.createElement("span");
  element.className = "ld-remote-caret-anchor";
  return element;
}

interface RemoteState {
  clientId: number;
  user: PresenceUser;
  head: unknown;
}

function remoteStates(provider: HocuspocusProvider): RemoteState[] {
  const awareness = provider.awareness;
  if (!awareness) return [];
  const states: RemoteState[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return;
    const user = state.user as PresenceUser | undefined;
    const cursor = state.cursor as { head?: unknown } | null | undefined;
    if (user?.id) {
      states.push({
        clientId,
        user: { ...user, color: publishedColor(user) },
        head: cursor?.head ?? null,
      });
    }
  });
  return states;
}

export function usePresence(provider: HocuspocusProvider | null, self: PresenceUser | null): PresenceUser[] {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  useEffect(() => {
    if (!provider) return;
    const update = () => {
      const unique = new Map<string, PresenceUser>();
      for (const state of remoteStates(provider))
        if (state.user.id !== self?.id) unique.set(state.user.id, state.user);
      setUsers([...unique.values()].sort((left, right) => left.name.localeCompare(right.name)));
    };
    update();
    provider.on("awarenessChange", update);
    return () => {
      provider.off("awarenessChange", update);
    };
  }, [provider, self?.id]);
  return users;
}

const VISIBLE_AVATARS = 3;

export type PictureOf = (accountId: string) => string | null | undefined;

export function PresenceAvatar({
  user,
  pictureRef,
  colorFor,
  children,
}: {
  user: PresenceUser;
  pictureRef?: string | null | undefined;
  colorFor?: ((user: PresenceUser) => string) | undefined;
  children?: ReactNode;
}) {
  return (
    <span
      {...(colorFor
        ? {
            "data-theme": "light",
            style: { "--presence-color": colorFor(user) } as CSSProperties,
          }
        : { "data-color": user.color })}
      className={`ld-presence-avatar${colorFor ? " ld-presence-avatar-cursor" : ""} relative inline-flex size-control-sm items-center justify-center rounded-full border-2 border-surface text-xs font-semibold`}
    >
      {pictureRef ? (
        <PersonAvatar id={user.id} name={user.name} pictureRef={pictureRef} size="sm" decorative />
      ) : (
        <span aria-hidden="true">{initialsOf(user.name)}</span>
      )}
      {children}
    </span>
  );
}

export function AvatarStack({
  self,
  others,
  colorFor,
  pictureOf,
}: {
  self: PresenceUser | null;
  others: PresenceUser[];
  colorFor?: (user: PresenceUser) => string;
  pictureOf?: PictureOf;
}) {
  const { t } = useTranslation();
  const everyone = self ? [self, ...others] : others;
  const visible = everyone.slice(0, VISIBLE_AVATARS);
  const hidden = everyone.slice(VISIBLE_AVATARS);
  return (
    <ul
      aria-label={t("editor.presence.label", { count: everyone.length })}
      className="flex items-center gap-1"
    >
      {visible.map((user) => (
        <li key={user.id}>
          <Tooltip content={user.id === self?.id ? t("editor.presence.you", { name: user.name }) : user.name}>
            <PresenceAvatar user={user} pictureRef={pictureOf?.(user.id)} colorFor={colorFor}>
              <span className="sr-only">{user.name}</span>
            </PresenceAvatar>
          </Tooltip>
        </li>
      ))}
      {hidden.length > 0 ? (
        <li>
          <Tooltip content={hidden.map((user) => user.name).join(", ")}>
            <span className="inline-flex size-control-sm items-center justify-center rounded-full border-2 border-surface bg-control text-xs font-semibold text-text">
              <span aria-hidden="true">+{hidden.length}</span>
              <span className="sr-only">{t("editor.presence.more", { count: hidden.length })}</span>
            </span>
          </Tooltip>
        </li>
      ) : null}
    </ul>
  );
}

interface CaretPosition {
  clientId: number;
  user: PresenceUser;
  left: number;
  top: number;
  height: number;
}

export function RemoteCarets({
  editor,
  provider,
  container,
}: {
  editor: Editor | null;
  provider: HocuspocusProvider | null;
  container: RefObject<HTMLElement | null>;
}) {
  const [carets, setCarets] = useState<CaretPosition[]>([]);
  useEffect(() => {
    if (!editor || !provider) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = container.current?.getBoundingClientRect();
        const sync = ySyncPluginKey.getState(editor.state) as
          | { doc: Y.Doc; type: Y.XmlFragment; binding?: { mapping: Map<unknown, unknown> } }
          | undefined;
        if (!box || !sync?.binding || editor.isDestroyed) return;
        const next: CaretPosition[] = [];
        for (const state of remoteStates(provider)) {
          if (!state.head) continue;
          const position = relativePositionToAbsolutePosition(
            sync.doc,
            sync.type,
            Y.createRelativePositionFromJSON(state.head),
            sync.binding.mapping as never,
          );
          if (position === null || position > editor.state.doc.content.size) continue;
          try {
            const coords = editor.view.coordsAtPos(position);
            next.push({
              clientId: state.clientId,
              user: state.user,
              left: coords.left - box.left,
              top: coords.top - box.top,
              height: coords.bottom - coords.top,
            });
          } catch {}
        }
        setCarets(next);
      });
    };
    measure();
    provider.on("awarenessChange", measure);
    editor.on("transaction", measure);
    globalThis.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      provider.off("awarenessChange", measure);
      editor.off("transaction", measure);
      globalThis.removeEventListener("resize", measure);
    };
  }, [editor, provider, container]);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {carets.map((caret) => (
        <div
          key={caret.clientId}
          data-color={caret.user.color}
          className="ld-remote-caret"
          style={{ transform: `translate(${caret.left}px, ${caret.top}px)`, height: `${caret.height}px` }}
        >
          <span className="ld-remote-caret-label">{caret.user.name}</span>
        </div>
      ))}
    </div>
  );
}
