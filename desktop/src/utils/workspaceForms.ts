import type {JobInput, ResumeVersion, Settings} from '../api/workspace';

export function normalizeJob(job: JobInput): JobInput {
  return {
    title: job.title.trim(),
    company: job.company.trim(),
    description: job.description.trim(),
    programming_language: job.programming_language?.trim() || '',
  };
}

export function sameResumeContent(
  original: Pick<ResumeVersion, 'filename' | 'text'> | null,
  filename: string,
  text: string,
) {
  return (
    !!original &&
    original.filename.trim() === filename.trim() &&
    original.text.trim() === text.trim()
  );
}

export function changedSettings(settings: Settings, baseline: Settings): Partial<Settings> {
  return Object.fromEntries(
    (Object.keys(settings) as (keyof Settings)[])
      .filter(key => settings[key] !== baseline[key])
      .map(key => [key, settings[key]]),
  );
}

/** The service has no resume-family id: collapse only versions with the same file name. */
export function groupResumeVersions(resumes: ResumeVersion[]) {
  const groups = new Map<string, ResumeVersion[]>();
  for (const resume of [...resumes].sort((a, b) => b.version - a.version)) {
    const key = `${resume.kind || 'resume'}:${resume.filename.trim().toLocaleLowerCase()}`;
    const versions = groups.get(key) || [];
    versions.push(resume);
    groups.set(key, versions);
  }
  return [...groups.values()] as [ResumeVersion, ...ResumeVersion[]][];
}
