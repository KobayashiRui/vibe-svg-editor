import {
  getDocumentViewBox,
  type GlyphSmithProject,
  type Selection,
} from "@glyphsmith/ast";

export function mcpResources() {
  return [
    {
      uri: "glyphsmith://project",
      name: "Project",
      title: "GlyphSmith Project",
      mimeType: "application/json",
    },
    {
      uri: "glyphsmith://pages",
      name: "Pages",
      title: "GlyphSmith Pages",
      mimeType: "application/json",
    },
    {
      uri: "glyphsmith://active-document",
      name: "Active Document",
      title: "Active Geometry Document",
      mimeType: "application/json",
    },
    {
      uri: "glyphsmith://comments",
      name: "Comments",
      title: "Active Document Comments",
      mimeType: "application/json",
    },
    {
      uri: "glyphsmith://selection",
      name: "Selection",
      title: "Editor Selection",
      mimeType: "application/json",
    },
    {
      uri: "glyphsmith://skill-guide",
      name: "Skill Guide",
      title: "GlyphSmith MCP Guide",
      mimeType: "text/markdown",
    },
  ];
}

export function mcpResourceTemplates() {
  return [
    {
      uriTemplate: "glyphsmith://document/{pageId}",
      name: "Document By Page",
      title: "Geometry Document By Page",
      mimeType: "application/json",
    },
  ];
}

export function readMcpResource(
  project: GlyphSmithProject,
  selection: Selection,
  revision: string,
  uri: string,
) {
  switch (uri) {
    case "glyphsmith://project":
      return mcpJsonResource(uri, { project, revision });
    case "glyphsmith://pages":
      return mcpJsonResource(uri, {
        pages: pagesSummary(project),
        activePageId: project.activePageId,
        revision,
      });
    case "glyphsmith://active-document":
      return mcpJsonResource(uri, {
        document: activePage(project).document,
        pageId: activePage(project).id,
        revision,
      });
    case "glyphsmith://comments":
      return mcpJsonResource(uri, {
        comments: activePage(project).document.comments,
        revision,
      });
    case "glyphsmith://selection":
      return mcpJsonResource(uri, { selection, revision });
    case "glyphsmith://skill-guide":
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: [
              "# GlyphSmith MCP",
              "",
              "Use GlyphSmith MCP for active `.gs.json` editor sessions.",
              "Read Geometry AST resources and apply small patch operations.",
              "Do not rewrite raw SVG strings for active editor changes.",
              "",
              "Before drawing or editing generated artwork, read `glyphsmith://project` or call `project_get` and follow `project.projectPrompt` when it is present.",
            ].join("\n"),
          },
        ],
      };
    default:
      if (uri.startsWith("glyphsmith://document/")) {
        const pageId = decodeURIComponent(
          uri.slice("glyphsmith://document/".length),
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

function activePage(project: GlyphSmithProject) {
  return (
    project.pages.find((page) => page.id === project.activePageId) ??
    project.pages[0]!
  );
}

function pagesSummary(project: GlyphSmithProject) {
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
