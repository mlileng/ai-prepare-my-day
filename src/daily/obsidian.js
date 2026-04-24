import fs from 'node:fs/promises';
import path from 'node:path';

function offsetDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDayTitle(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function dailyNotePath(vaultPath, date) {
  return path.join(vaultPath, 'daily', `${date}.md`);
}

export async function findTodayNote(vaultPath, date) {
  try {
    await fs.access(dailyNotePath(vaultPath, date));
    return true;
  } catch {
    return false;
  }
}

export async function hasMeetingsSection(vaultPath, date) {
  try {
    const content = await fs.readFile(dailyNotePath(vaultPath, date), 'utf8');
    return /^## Meetings$/m.test(content);
  } catch {
    return false;
  }
}

export async function createDailyNote(vaultPath, date, meetingLines) {
  await fs.mkdir(path.join(vaultPath, 'daily'), { recursive: true });

  const prev = offsetDate(date, -1);
  const next = offsetDate(date, 1);
  const title = formatDayTitle(date);
  const meetingsSection = meetingLines.length > 0
    ? `## Meetings\n\n${meetingLines.join('\n')}\n`
    : `## Meetings\n`;

  const content = `---
type: daily-note
date: ${date}
tags: [daily-note]
---

# ${title}

← [[daily/${prev}]] | [[daily/${next}]] →

${meetingsSection}
## Today's Focus

`;

  await fs.writeFile(dailyNotePath(vaultPath, date), content, 'utf8');
}

export async function prependMeetingsSection(vaultPath, date, meetingLines) {
  const filePath = dailyNotePath(vaultPath, date);
  const content = await fs.readFile(filePath, 'utf8');
  const meetingsSection = `\n\n## Meetings\n\n${meetingLines.join('\n')}\n`;

  // Insert after the nav line (← ... | ... →)
  const navPattern = /^← \[\[.*?\]\] \| \[\[.*?\]\] →$/m;
  const match = content.match(navPattern);

  let updated;
  if (match) {
    const insertAt = match.index + match[0].length;
    updated = content.slice(0, insertAt) + meetingsSection + content.slice(insertAt);
  } else {
    // Fallback: insert after frontmatter block
    updated = content.replace(/^---\n[\s\S]*?\n---\n/, m => m + meetingsSection);
  }

  await fs.writeFile(filePath, updated, 'utf8');
}
