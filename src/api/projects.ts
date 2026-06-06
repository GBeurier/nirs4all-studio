/**
 * Projects API client — project CRUD for grouping runs.
 */

import { api } from "./transport";
import type { ProjectsResponse } from "@/types/projects";

export async function listProjects(): Promise<ProjectsResponse> {
  return api.get("/projects");
}

export async function createProject(data: { name: string; description?: string; color?: string }): Promise<{ project_id: string; name: string }> {
  return api.post("/projects", data);
}

export async function updateProject(projectId: string, data: { name?: string; description?: string; color?: string }): Promise<{ success: boolean }> {
  return api.put(`/projects/${projectId}`, data);
}

export async function deleteProject(projectId: string): Promise<{ success: boolean }> {
  return api.delete(`/projects/${projectId}`);
}
