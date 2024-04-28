import { about } from "#site/content";
import { MDXContent } from "@/components/mdx-component";

const AboutPage = () => {
  return (
    <article className="container py-6 prose dark:prose-invert max-w-3xl mx-auto">
      {about.map((info: any) => (
        <div key={info.title}>
          <h1 className="mb-2">{info.title}</h1>
          {info.description && (
            <p className="text-xl mt-0 text-muted-foreground">
              {info.description}
            </p>
          )}
          <hr className="my-4" />
          <MDXContent code={info.body} />
        </div>
      ))}
    </article>
  );
};

export default AboutPage;
