import { Button, Card, CardBody, CardHeader, Divider } from "@heroui/react";
import React from "react";
import { LuRefreshCw, LuTriangleAlert } from "react-icons/lu";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";

function formatError(err) {
  if (!err) return { title: "Unknown error", detail: "" };
  if (isRouteErrorResponse(err)) {
    return {
      title: `${err.status} ${err.statusText || "Error"}`,
      detail: typeof err.data === "string" ? err.data : "",
    };
  }
  if (err instanceof Error) {
    return { title: err.message || "Application error", detail: err.stack || "" };
  }
  if (typeof err === "string") return { title: err, detail: "" };
  try {
    return { title: "Application error", detail: JSON.stringify(err, null, 2) };
  } catch (e) {
    return { title: "Application error", detail: String(err) };
  }
}

export default function ErrorPage({ error, resetError }) {
  const routeError = useRouteError();
  const navigate = useNavigate();
  const { title, detail } = formatError(error || routeError);
  const isDev = import.meta.env.MODE !== "production";

  const handleReload = () => {
    if (resetError) resetError();
    window.location.reload();
  };

  const handleHome = () => {
    if (resetError) resetError();
    navigate("/");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
      <Card className="max-w-xl w-full">
        <CardHeader className="flex flex-col items-center gap-2 pt-6">
          <LuTriangleAlert size={48} className="text-warning" />
          <h1 className="text-2xl font-tw font-bold">Something went wrong</h1>
          <p className="text-sm text-foreground-500 text-center">
            We hit an unexpected error rendering this page. You can reload to try again
            or head back to your dashboard.
          </p>
        </CardHeader>
        <Divider />
        <CardBody className="gap-4">
          <div className="flex flex-row gap-2 justify-center">
            <Button color="primary" startContent={<LuRefreshCw />} onPress={handleReload}>
              Reload page
            </Button>
            <Button variant="flat" onPress={handleHome}>
              Back to dashboard
            </Button>
          </div>
          {isDev && (
            <div className="mt-2">
              <div className="text-sm font-semibold text-foreground-700">{title}</div>
              {detail && (
                <pre className="mt-2 text-xs bg-content2 p-3 rounded-md overflow-auto max-h-64 whitespace-pre-wrap break-words">
                  {detail}
                </pre>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
