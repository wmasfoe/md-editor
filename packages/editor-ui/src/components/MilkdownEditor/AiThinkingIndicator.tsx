import { SparklesIcon } from "@heroicons/react/24/outline";

interface AiThinkingIndicatorProps {
  readonly visible: boolean;
}

export function AiThinkingIndicator({ visible }: AiThinkingIndicatorProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="md-ai-thinking-indicator" role="status" aria-label="AI 正在思考">
      <SparklesIcon aria-hidden="true" />
    </div>
  );
}
