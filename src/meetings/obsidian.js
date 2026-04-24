import fs from 'node:fs/promises';
import path from 'node:path';

const SERIES_DIR = 'meetings/series';
const INSTANCES_DIR = 'meetings/instances';

function parseFrontmatterName(content) {
  const block = content.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return null;
  const match = block[1].match(/^name:\s*"?([^"\n]+)"?\s*$/m);
  return match ? match[1].trim() : null;
}

export async function fetchAllSeries(vaultPath) {
  const seriesDir = path.join(vaultPath, SERIES_DIR);
  let files;
  try {
    files = await fs.readdir(seriesDir);
  } catch {
    return [];
  }

  const mdFiles = files.filter(f => f.endsWith('.md'));
  const series = [];

  for (const file of mdFiles) {
    const slug = file.replace(/\.md$/, '');
    let name = slug;
    try {
      const content = await fs.readFile(path.join(seriesDir, file), 'utf8');
      name = parseFrontmatterName(content) ?? slug;
    } catch {
      // skip unreadable files
    }

    let mtime = new Date(0);
    try {
      const stats = await fs.stat(path.join(seriesDir, file));
      mtime = stats.mtime;
    } catch {
      // use epoch as fallback
    }

    series.push({
      id: `${SERIES_DIR}/${file}`,
      slug,
      last_edited_time: mtime.toISOString(),
      properties: {
        title: {
          type: 'title',
          title: [{ plain_text: name }],
        },
      },
    });
  }

  return series;
}

export async function findExistingInstance(vaultPath, date, seriesSlug) {
  const filePath = path.join(vaultPath, INSTANCES_DIR, `${date}-${seriesSlug}.md`);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function createMeetingInstance(vaultPath, event, date, seriesSlug, seriesId) {
  const fileName = `${date}-${seriesSlug}.md`;
  const relPath = `${INSTANCES_DIR}/${fileName}`;
  const absPath = path.join(vaultPath, relPath);

  // Idempotency guard — never overwrite an existing instance
  const exists = await findExistingInstance(vaultPath, date, seriesSlug);
  if (exists) return relPath;

  await fs.mkdir(path.join(vaultPath, INSTANCES_DIR), { recursive: true });

  const seriesLink = seriesId ? `"[[${seriesId.replace(/\.md$/, '')}]]"` : '""';
  const content = `---
type: meeting-instance
date: ${date}
series: ${seriesLink}
participants: []
tags: [meeting-instance]
---

## Agenda / Context

${event.title} — ${event.displayRange}

## Key Discussion Points

## Decisions

## Action Items

## My Summary

## Links
`;

  await fs.writeFile(absPath, content, 'utf8');
  return relPath;
}
