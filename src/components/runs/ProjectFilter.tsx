import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolderKanban, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { listProjects } from "@/api/client";

interface ProjectFilterProps {
  selectedProjectId: string | null;
  onProjectChange: (projectId: string | null) => void;
}

export function ProjectFilter({ selectedProjectId, onProjectChange }: ProjectFilterProps) {
  const { data } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 30000,
  });

  const projects = data?.projects || [];
  const selectedProject = projects.find((p) => p.project_id === selectedProjectId);

  if (projects.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FolderKanban className="h-4 w-4" />
          {selectedProject ? selectedProject.name : "All Projects"}
          {selectedProjectId && (
            <X
              className="h-3 w-3 ml-1 hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onProjectChange(null);
              }}
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onProjectChange(null)}>
          <span className={cn("mr-2", !selectedProjectId && "font-semibold")}>All Projects</span>
          {!selectedProjectId && <Check className="h-4 w-4 ml-auto" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {projects.map((project) => (
          <DropdownMenuItem key={project.project_id} onClick={() => onProjectChange(project.project_id)}>
            <div
              className="w-3 h-3 rounded-full mr-2 shrink-0"
              style={{ backgroundColor: project.color }}
            />
            <span className={cn(selectedProjectId === project.project_id && "font-semibold")}>
              {project.name}
            </span>
            {selectedProjectId === project.project_id && <Check className="h-4 w-4 ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
