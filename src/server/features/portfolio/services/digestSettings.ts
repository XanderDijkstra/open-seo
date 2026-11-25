import { env } from "cloudflare:workers";
import { z } from "zod";
import { ProjectService } from "@/server/features/projects/services/ProjectService";

// Projects the daily digest email leaves out, per organization. A project is
// included unless it is listed here, so new projects join the email on their
// own.
const excludedKey = (organizationId: string) =>
  `portfolio-digest-excluded:${organizationId}`;
const excludedSchema = z.array(z.string());

async function getExcludedProjectIds(organizationId: string) {
  const stored = await env.KV.get(excludedKey(organizationId), "json");
  const parsed = excludedSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

/** Every project in the organization, with whether the digest includes it. */
async function listProjects(organizationId: string) {
  const [projects, excluded] = await Promise.all([
    ProjectService.listProjects(organizationId),
    getExcludedProjectIds(organizationId),
  ]);
  return projects.map((project) => ({
    projectId: project.id,
    name: project.name,
    domain: project.domain,
    included: !excluded.includes(project.id),
  }));
}

async function setIncluded(
  organizationId: string,
  projectIds: string[],
  included: boolean,
) {
  const owned = new Set(
    (await ProjectService.listProjects(organizationId)).map((p) => p.id),
  );
  const excluded = new Set(
    // Dropping ids of deleted projects keeps the list from growing forever.
    (await getExcludedProjectIds(organizationId)).filter((id) => owned.has(id)),
  );
  for (const projectId of projectIds) {
    if (!owned.has(projectId)) continue;
    if (included) excluded.delete(projectId);
    else excluded.add(projectId);
  }
  await env.KV.put(excludedKey(organizationId), JSON.stringify([...excluded]));
}

export const DigestSettings = {
  getExcludedProjectIds,
  listProjects,
  setIncluded,
};
