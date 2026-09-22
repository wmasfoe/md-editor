-- D1 Migration: 为统计页面提供兼容旧数据的聚合视图
-- 只新增索引和视图，不修改或删除 downloads 中的历史记录。

CREATE INDEX IF NOT EXISTS idx_downloads_app_version_platform
  ON downloads (app, version, platform);

CREATE VIEW IF NOT EXISTS download_totals AS
SELECT
  app,
  COUNT(*) AS total_downloads
FROM downloads
GROUP BY app;

CREATE VIEW IF NOT EXISTS download_version_totals AS
SELECT
  app,
  version,
  COUNT(*) AS total_downloads
FROM downloads
GROUP BY app, version;

CREATE VIEW IF NOT EXISTS download_version_platform_totals AS
SELECT
  app,
  version,
  platform,
  COUNT(*) AS total_downloads
FROM downloads
GROUP BY app, version, platform;
