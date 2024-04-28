import { projects } from "#site/content";
import { MDXContent } from "@/components/mdx-component";
import { notFound } from "next/navigation";

interface ProjectPageProps {
  params: {
    slug: string[];
  };
}

async function getProjectFromParams(params: ProjectPageProps["params"]) {
  const slug = params?.slug?.join("/");
  const project = projects.find((project) => project.slugAsParams === slug);

  return project;
}

export async function generateStaticParams(): Promise<
  ProjectPageProps["params"][]
> {
  return projects.map((project) => ({ slug: project.slugAsParams.split("/") }));
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const project = await getProjectFromParams(params);

  if (!project || !project.published) {
    notFound();
  }

  return (
    <article className="container py-6 prose dark:prose-invert max-w-3xl mx-auto">
      <h1 className="mb-2">{project.title}</h1>
      {project.description ? (
        <p className="text-xl mt-0 text-muted-foreground">
          {project.description}
        </p>
      ) : null}
      <hr className="my-4" />
      <MDXContent code={project.body} />
    </article>
  );
}
