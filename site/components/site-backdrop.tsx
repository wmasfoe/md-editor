/**
 * 全站固定背景层：液态玻璃只折射「背后真实像素」。
 * 必须独立于内容树，且自身不用 transform/filter 影响子孙的 backdrop 采样。
 */
export function SiteBackdrop() {
  return (
    <div className="site-backdrop" aria-hidden>
      {/* 底层深色渐变：让白色 glass 文字可读，并提供色相对比 */}
      <div className="site-backdrop__base" />
      {/* 大块色斑：被 glass 折射后才会出现「液态」观感 */}
      <div className="site-backdrop__orb site-backdrop__orb--a" />
      <div className="site-backdrop__orb site-backdrop__orb--b" />
      <div className="site-backdrop__orb site-backdrop__orb--c" />
      <div className="site-backdrop__orb site-backdrop__orb--d" />
      {/* 轻微网格/噪声，增加折射纹理细节 */}
      <div className="site-backdrop__grain" />
    </div>
  );
}
