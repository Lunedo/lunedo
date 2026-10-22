import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Flag, Repeat } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTopicReference } from "../references.js";

export function TopicUpdateView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const topicId = typeof node.attrs.topicId === "string" ? node.attrs.topicId : null;
  const topic = useTopicReference(topicId);
  return (
    <NodeViewWrapper as="section" className="ld-topic-update" data-topic-id={topicId ?? undefined}>
      <p contentEditable={false} className="ld-topic-update-title">
        <Repeat aria-hidden="true" className="size-icon-sm" />
        {topic?.title ?? t("editor.topicUpdate.unknown")}
        {topic?.status === "closed" ? (
          <span className="ld-topic-update-closed">{t("editor.topicUpdate.closed")}</span>
        ) : null}
      </p>
      <NodeViewContent className="ld-topic-update-content" />
    </NodeViewWrapper>
  );
}

export function DecisionView() {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper as="aside" className="ld-decision" role="note" aria-label={t("editor.decision.label")}>
      <span contentEditable={false} className="ld-decision-label">
        <Flag aria-hidden="true" className="size-icon-sm" />
        {t("editor.decision.label")}
      </span>
      <NodeViewContent className="ld-decision-content" />
    </NodeViewWrapper>
  );
}
