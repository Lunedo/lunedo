import "./excalidraw-setup.js";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToSvg,
  getSceneVersion,
  MainMenu,
  reconcileElements,
} from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type { Scene, SceneFile } from "@lunedo/editor-schema/scene";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type * as Y from "yjs";
import type { PresenceUser } from "../editor/presence.js";
import { nameUnlabeledControls } from "./controls.js";
import {
  type FileStore,
  type LocalFile,
  type RefusedElement,
  SceneSync,
  type SyncElement,
  storedElements,
} from "./scene-sync.js";

const STICKY_BACKGROUND = "#ffec99";
const STICKY_STROKE = "#f08c00";
const POINTER_INTERVAL_MS = 50;

export interface BoardHandle {
  api: ExcalidrawImperativeAPI;
  focusElement: (elementId: string) => void;
  exportSvg: () => Promise<string>;
  version: () => number;
  sceneForSaving: (files: (file: LocalFile) => Promise<SceneFile>) => Promise<Scene>;
  addStickyNote: () => void;
}

export interface ExcalidrawBoardProps {
  scene: Scene;
  editable: boolean;
  doc?: Y.Doc | null;
  provider?: HocuspocusProvider | null;
  self?: PresenceUser | null;
  files: FileStore;
  name: string;
  onReady?: (handle: BoardHandle) => void;
  onSelectionChange?: (elementIds: string[]) => void;
  onRefused?: (refused: RefusedElement[]) => void;
  onFileFailed?: (error: unknown) => void;
  onLocalChange?: () => void;
}

function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function initialElements(scene: Scene): ExcalidrawElement[] {
  return scene.elements as unknown as ExcalidrawElement[];
}

function whenInitialized(api: ExcalidrawImperativeAPI, start: () => void): () => void {
  if (!api.getAppState().isLoading) {
    start();
    return () => undefined;
  }
  let started = false;
  const unsubscribe = api.onChange((_elements, appState) => {
    if (started || appState.isLoading) return;
    started = true;
    unsubscribe();
    start();
  });
  return () => {
    started = true;
    unsubscribe();
  };
}

function selectedIds(appState: AppState): string[] {
  return Object.entries(appState.selectedElementIds)
    .filter(([, selected]) => selected)
    .map(([id]) => id)
    .sort();
}

interface RemotePresence {
  user?: PresenceUser;
  pointer?: { x: number; y: number; tool: "pointer" | "laser" } | null;
  button?: "up" | "down";
  selection?: string[];
}

export function ExcalidrawBoard({
  scene,
  editable,
  doc = null,
  provider = null,
  self = null,
  files,
  name,
  onReady,
  onSelectionChange,
  onRefused,
  onFileFailed,
  onLocalChange,
}: ExcalidrawBoardProps) {
  const { t, i18n } = useTranslation();
  const theme = useDocumentTheme();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const sync = useRef<SceneSync | null>(null);
  const selection = useRef<string>("");
  const lastPointer = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const initialData = useMemo(
    () => ({
      elements: doc
        ? (storedElements(doc).filter((element) => !element.isDeleted) as unknown as ExcalidrawElement[])
        : initialElements(scene),
      appState: {
        viewBackgroundColor: scene.settings.viewBackgroundColor ?? "#ffffff",
        viewModeEnabled: !editable,
      },
      scrollToContent: true,
    }),
    [scene, editable, doc],
  );

  useEffect(() => {
    if (!api || doc) return;
    api.updateScene({
      elements: initialElements(scene),
      appState: { viewBackgroundColor: scene.settings.viewBackgroundColor ?? "#ffffff" },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    let cancelled = false;
    const present = api.getFiles();
    for (const [id, file] of Object.entries(scene.files)) {
      if (present[id]) continue;
      files
        .load(file.attachmentId, file.mimeType)
        .then((dataURL) => {
          if (!cancelled) {
            api.addFiles([
              { id, mimeType: file.mimeType, dataURL, created: Date.now() } as unknown as BinaryFileData,
            ]);
          }
        })
        .catch((error: unknown) => onFileFailed?.(error));
    }
    return () => {
      cancelled = true;
    };
  }, [api, doc, scene, files, onFileFailed]);

  useEffect(() => {
    if (!api || !doc) return;
    const target = {
      elements: () => api.getSceneElementsIncludingDeleted() as unknown as readonly SyncElement[],
      replaceElements: (elements: readonly SyncElement[]) =>
        api.updateScene({
          elements: elements as unknown as ExcalidrawElement[],
          captureUpdate: CaptureUpdateAction.NEVER,
        }),
      files: () => api.getFiles() as unknown as Record<string, LocalFile>,
      addFiles: (added: LocalFile[]) => api.addFiles(added as unknown as BinaryFileData[]),
      backgroundColor: () => api.getAppState().viewBackgroundColor,
      setBackgroundColor: (color: string | null) =>
        api.updateScene({
          appState: { viewBackgroundColor: color ?? "#ffffff" },
          captureUpdate: CaptureUpdateAction.NEVER,
        }),
    };
    const stop = whenInitialized(api, () => {
      const created = new SceneSync({
        doc,
        target,
        reconcile: (local, remote) =>
          reconcileElements(
            local as unknown as readonly OrderedExcalidrawElement[],
            remote as unknown as readonly RemoteExcalidrawElement[],
            api.getAppState(),
          ) as unknown as SyncElement[],
        files,
        editable,
        ...(onRefused ? { onRefused } : {}),
        ...(onFileFailed ? { onFileFailed } : {}),
        ...(onLocalChange ? { onSent: onLocalChange } : {}),
      });
      sync.current = created;
      created.pull();
    });
    return () => {
      stop();
      sync.current?.destroy();
      sync.current = null;
    };
  }, [api, doc, files, editable, onRefused, onFileFailed, onLocalChange]);

  useEffect(() => {
    if (!api || !provider) return;
    const awareness = provider.awareness;
    if (!awareness) return;
    const update = () => {
      const collaborators = new Map<SocketId, Collaborator>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const presence = state as RemotePresence;
        if (!presence.user?.id) return;
        collaborators.set(String(clientId) as SocketId, {
          id: presence.user.id,
          username: presence.user.name,
          ...(presence.pointer ? { pointer: presence.pointer } : {}),
          ...(presence.button ? { button: presence.button } : {}),
          selectedElementIds: Object.fromEntries((presence.selection ?? []).map((id) => [id, true])),
        });
      });
      api.updateScene({ collaborators });
    };
    update();
    provider.on("awarenessChange", update);
    return () => {
      provider.off("awarenessChange", update);
    };
  }, [api, provider]);

  useEffect(() => {
    if (provider && self) provider.setAwarenessField("user", self);
  }, [provider, self]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const label = () => nameUnlabeledControls(element, t("whiteboards.menu"));
    label();
    const observer = new MutationObserver(label);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [t]);

  const focusElement = useCallback(
    (elementId: string) => {
      if (!api) return;
      const element = api.getSceneElements().find((candidate) => candidate.id === elementId);
      if (!element) return;
      api.updateScene({
        appState: { selectedElementIds: { [elementId]: true } },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      api.scrollToContent(element, { fitToContent: false, animate: true });
    },
    [api],
  );

  const exportSvg = useCallback(async () => {
    if (!api) return "";
    const svg = await exportToSvg({
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false },
      files: api.getFiles(),
      exportPadding: 16,
    });
    return new XMLSerializer().serializeToString(svg);
  }, [api]);

  const sceneForSaving = useCallback(
    async (store: (file: LocalFile) => Promise<SceneFile>): Promise<Scene> => {
      if (!api) return scene;
      const elements = JSON.parse(JSON.stringify(api.getSceneElements())) as Scene["elements"];
      const used = new Set(
        elements.flatMap((element) =>
          element.type === "image" && typeof element.fileId === "string" ? [element.fileId] : [],
        ),
      );
      const stored: Record<string, SceneFile> = {};
      for (const file of Object.values(api.getFiles() as unknown as Record<string, LocalFile>)) {
        if (!used.has(file.id)) continue;
        stored[file.id] = scene.files[file.id] ?? (await store(file));
      }
      return {
        elements,
        files: stored,
        settings: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
      };
    },
    [api, scene],
  );

  const addStickyNote = useCallback(() => {
    if (!api) return;
    const appState = api.getAppState();
    const width = 200;
    const height = 120;
    const x = -appState.scrollX + appState.width / 2 / appState.zoom.value - width / 2;
    const y = -appState.scrollY + appState.height / 2 / appState.zoom.value - height / 2;
    const created = convertToExcalidrawElements([
      {
        type: "rectangle",
        x,
        y,
        width,
        height,
        backgroundColor: STICKY_BACKGROUND,
        strokeColor: STICKY_STROKE,
        fillStyle: "solid",
        roughness: 0,
        customData: { stickyNote: true },
        label: { text: t("whiteboards.stickyNote.placeholder"), fontSize: 20 },
      },
    ]);
    const note = created[0];
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...created],
      appState: note ? { selectedElementIds: { [note.id]: true } } : null,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, [api, t]);

  useEffect(() => {
    if (api) {
      onReady?.({
        api,
        focusElement,
        exportSvg,
        sceneForSaving,
        addStickyNote,
        version: () => getSceneVersion(api.getSceneElementsIncludingDeleted()),
      });
    }
  }, [api, onReady, focusElement, exportSvg, sceneForSaving, addStickyNote]);

  const onChange = useCallback(
    (_elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
      sync.current?.changed();
      const ids = selectedIds(appState);
      const key = ids.join(",");
      if (key !== selection.current) {
        selection.current = key;
        onSelectionChange?.(ids);
        provider?.setAwarenessField("selection", ids);
      }
    },
    [onSelectionChange, provider],
  );

  const onPointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => {
      if (!provider) return;
      const now = Date.now();
      if (now - lastPointer.current < POINTER_INTERVAL_MS) return;
      lastPointer.current = now;
      provider.setAwarenessField("pointer", payload.pointer);
      provider.setAwarenessField("button", payload.button);
    },
    [provider],
  );

  return (
    <div ref={container} className="ld-whiteboard h-full w-full">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        onPointerUpdate={onPointerUpdate}
        isCollaborating={doc !== null}
        viewModeEnabled={!editable}
        theme={theme}
        name={name}
        langCode={i18n.language === "de" ? "de-DE" : "en"}
        aiEnabled={false}
        validateEmbeddable={false}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            toggleTheme: null,
            clearCanvas: editable,
            changeViewBackgroundColor: editable,
            saveAsImage: true,
          },
          tools: { image: editable },
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          {editable ? <MainMenu.DefaultItems.ChangeCanvasBackground /> : null}
          {editable ? <MainMenu.DefaultItems.ClearCanvas /> : null}
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
