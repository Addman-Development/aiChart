import React from "react";
import ReactDOM from "react-dom/client";
import ace from "ace-builds";
import workerJsonUrl from "ace-builds/src-min-noconflict/worker-json?url";
import workerJavascriptUrl from "ace-builds/src-min-noconflict/worker-javascript?url";
import workerCssUrl from "ace-builds/src-min-noconflict/worker-css?url";
import App from "./App.jsx";
import "./input.css";
import "./index.css";

ace.config.setModuleUrl("ace/mode/json_worker", workerJsonUrl);
ace.config.setModuleUrl("ace/mode/javascript_worker", workerJavascriptUrl);
ace.config.setModuleUrl("ace/mode/css_worker", workerCssUrl);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
