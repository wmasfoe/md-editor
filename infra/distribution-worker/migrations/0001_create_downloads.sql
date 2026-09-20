-- D1 Migration: 创建下载统计表
-- 运行方式: npx wrangler d1 migrations apply inkpoint-download-analytics

CREATE TABLE IF NOT EXISTS downloads (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  app       TEXT    NOT NULL,
  platform  TEXT    NOT NULL,
  version   TEXT    NOT NULL,
  file_name TEXT    NOT NULL,
  country   TEXT    NOT NULL DEFAULT 'unknown',
  source    TEXT    NOT NULL DEFAULT 'direct',
  user_agent TEXT   NOT NULL DEFAULT '',
  timestamp TEXT    NOT NULL
);

-- 按版本和平台查询的高频场景索引
CREATE INDEX IF NOT EXISTS idx_downloads_version   ON downloads (app, version);
CREATE INDEX IF NOT EXISTS idx_downloads_platform   ON downloads (app, platform);
CREATE INDEX IF NOT EXISTS idx_downloads_timestamp  ON downloads (timestamp);
CREATE INDEX IF NOT EXISTS idx_downloads_country    ON downloads (country);
