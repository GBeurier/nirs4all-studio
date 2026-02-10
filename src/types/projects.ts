export interface Project {
  project_id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectsResponse {
  projects: Project[];
  total: number;
}
