import { projects } from "#site/content";
import ProjectItem from "@/components/project-item";
import { sortProjects } from "@/lib/utils";

const PROJECTS_PER_PAGE = 5;

interface ProjectPageProps {
  searchParams: {
    page?: string;
  };
}
const ProjectsPage = async ({ searchParams }: ProjectPageProps) => {
  const currentPage = Number(searchParams?.page) || 1;
  // Filter out unpublished projects
  const sortedProjects = sortProjects(
    projects.filter((project) => project.published !== false)
  );
  const totalPages = Math.ceil(sortedProjects.length / PROJECTS_PER_PAGE);

  const displayProjects = sortedProjects.slice(
    PROJECTS_PER_PAGE * (currentPage - 1),
    PROJECTS_PER_PAGE * currentPage
  );
  return (
    <div className="container max-w-4xl py-6 lg:py-10">
      <div className="flex flex-col items-start gap-4 md:flex-row md:justify-between md:gap-8">
        <div className="flex-1 space-y-4">
          <h1 className="inline-block font-black text-4xl lg:text-5xl">
            Projects
          </h1>
          <p className="text-xl text-muted-foreground">
            Some cool stuff I worked on
          </p>
        </div>
      </div>
      <hr className="mt-8" />
      {displayProjects?.length > 0 ? (
        <ul className="flex flex-col">
          {displayProjects.map((project: any) => {
            const { slug, date, title, description } = project;
            return (
              <li key={slug}>
                <ProjectItem
                  slug={slug}
                  date={date}
                  title={title}
                  description={description}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Nothing to see here yet</p>
      )}
    </div>
  );
};

export default ProjectsPage;
