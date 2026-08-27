import {
  getDocumentViewBox,
  type VibeSVGProject,
  type Selection,
} from "@vibesvg/ast";

export function mcpResources() {
  return [
    {
      uri: "vibesvg://project",
      name: "Project",
      title: "VibeSVG Project",
      mimeType: "application/json",
    },
    {
      uri: "vibesvg://pages",
      name: "Pages",
      title: "VibeSVG Pages",
      mimeType: "application/json",
    },
    {
      uri: "vibesvg://active-document",
      name: "Active Document",
      title: "Active Geometry Document",
      mimeType: "application/json",
    },
    {
      uri: "vibesvg://comments",
      name: "Comments",
      title: "Active Document Comments",
      mimeType: "application/json",
    },
    {
      uri: "vibesvg://selection",
      name: "Selection",
      title: "Editor Selection",
      mimeType: "application/json",
    },
    {
      uri: "vibesvg://skill-guide",
      name: "Skill Guide",
      title: "VibeSVG MCP Guide",
      mimeType: "text/markdown",
    },
  ];
}

export function mcpResourceTemplates() {
  return [
    {
      uriTemplate: "vibesvg://document/{pageId}",
      name: "Document By Page",
      title: "Geometry Document By Page",
      mimeType: "application/json",
    },
  ];
}

export function readMcpResource(
  project: VibeSVGProject,
  selection: Selection,
  revision: string,
  uri: string,
) {
  switch (uri) {
    case "vibesvg://project":
      return mcpJsonResource(uri, { project, revision });
    case "vibesvg://pages":
      return mcpJsonResource(uri, {
        pages: pagesSummary(project),
        activePageId: project.activePageId,
        revision,
      });
    case "vibesvg://active-document":
      return mcpJsonResource(uri, {
        document: activePage(project).document,
        pageId: activePage(project).id,
        revision,
      });
    case "vibesvg://comments":
      return mcpJsonResource(uri, {
        comments: activePage(project).document.comments,
        revision,
      });
    case "vibesvg://selection":
      return mcpJsonResource(uri, { selection, revision });
    case "vibesvg://skill-guide":
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: [
              "# VibeSVG MCP",
              "",
              "Use VibeSVG MCP for active `.vsvg.json` editor sessions.",
              "Read Geometry AST resources and apply small patch operations.",
              "Do not rewrite raw SVG strings for active editor changes.",
              "",
              "Before drawing or editing generated artwork, read `vibesvg://project` or call `project_get` and follow `project.projectPrompt` when it is present.",
            ].join("\n"),
          },
        ],
      };
    default:
      if (uri.startsWith("vibesvg://document/")) {
        const pageId = decodeURIComponent(
          uri.slice("vibesvg://document/".length),
        );
        const page = project.pages.find((item) => item.id === pageId);

        if (!page) {
          throw new Error(`Unknown pageId: ${pageId}`);
        }

        return mcpJsonResource(uri, {
          document: page.document,
          pageId,
          revision,
        });
      }

      throw new Error(`Unknown MCP resource URI: ${uri}`);
  }
}

function activePage(project: VibeSVGProject) {
  return (
    project.pages.find((page) => page.id === project.activePageId) ??
    project.pages[0]!
  );
}

function pagesSummary(project: VibeSVGProject) {
  return project.pages.map((page) => ({
    id: page.id,
    name: page.name,
    width: page.document.width,
    height: page.document.height,
    viewBox: getDocumentViewBox(page.document),
    nodeCount: page.document.root.children.length,
    commentCount: page.document.comments.length,
  }));
}

export function mcpJsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
