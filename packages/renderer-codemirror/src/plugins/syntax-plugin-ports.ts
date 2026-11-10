/**
 * @file syntax-plugin-ports.ts
 * @description 语法插件宿主端口的**渲染器侧默认实现**。
 *
 * facet 本身定义在契约层（`@md-editor/plugin-sdk/syntax` 的 `syntaxPluginHostPortsFacet`），
 * 因为 facet 实例必须被宿主与插件共享同一引用才能命中；若定义在渲染器里，插件就得
 * import 渲染器才能读到它——正是本模块要消除的反向依赖。
 *
 * 本模块只负责把渲染器自带的媒体查看器实现**注入**该 facet：
 * - 使用 `createCodeMirrorRenderer` 的宿主无需配置即获得完整能力；
 * - 自定义宿主可用 `syntaxPluginHostPortsFacet.of(customPorts)` 覆盖；
 * - 不想要浮层的宿主传 `of({})`，插件据此优雅降级。
 */

import type { SyntaxPluginHostPorts } from "@md-editor/plugin-sdk/syntax";

import { CalloutFooterWidget, CalloutHeaderWidget } from "../wysiwyg/widgets/callout-widget.ts";
import { closeMediaViewerFor, openMediaViewer } from "../media-viewer/index.ts";

/**
 * 渲染器默认端口实现（延迟构造以利 tree-shake：未使用媒体查看器的宿主不会引入该模块）。
 */
export function createDefaultSyntaxPluginHostPorts(): SyntaxPluginHostPorts {
  return {
    openMediaViewer: (options) => openMediaViewer(options),
    closeMediaViewerFor: (host) => closeMediaViewerFor(host),
    createCalloutHeaderWidget: ({ type, title, recordId }) =>
      new CalloutHeaderWidget(type, title, recordId),
    createCalloutFooterWidget: () => new CalloutFooterWidget(),
  };
}
