import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { getAuthToken } from "../modules/auth";
import { API_HOST } from "../config/settings";

const initialState = {
  loading: false,
  error: false,
  data: [],
  shared: [],
  sharedLoading: false,
};

export const getTeamConnections = createAsyncThunk(
  "connection/getTeamConnections",
  async ({ team_id }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections`;
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    const response = await fetch(url, { headers, method: "GET" });

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const data = await response.json();
    return data;
  }
);

export const getConnection = createAsyncThunk(
  "connection/getConnection",
  async ({ team_id, connection_id }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection_id}`;
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    const response = await fetch(url, { headers, method: "GET" });
    const data = await response.json();
    return data;
  }
);

export const addConnection = createAsyncThunk(
  "connection/addConnection",
  async ({ team_id, connection }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections`;
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    });
    const body = JSON.stringify(connection);
    const response = await fetch(url, { headers, method: "POST", body });
    const data = await response.json();
    return data;
  }
);

export const saveConnection = createAsyncThunk(
  "connection/saveConnection",
  async ({ team_id, connection }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection.id}`;
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    });
    const body = JSON.stringify(connection);
    const response = await fetch(url, { headers, method: "PUT", body });
    const data = await response.json();
    return data;
  }
);

// Fetch the list of schema names available on a SQL connection so the form can
// offer them for selection. Sends the current (possibly unsaved) connection
// params, mirroring testRequest.
export const getConnectionSchemas = createAsyncThunk(
  "connection/getConnectionSchemas",
  async ({ team_id, connection }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection.type}/schemas`;
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    });
    const body = JSON.stringify(connection);
    const response = await fetch(url, { headers, method: "POST", body });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Failed to load schemas (${response.status})`);
    }
    return response.json();
  }
);

export const addFilesToConnection = createAsyncThunk(
  "connection/addFilesToConnection",
  async ({ team_id, connection_id, files }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection_id}/files`;
    const formData = new FormData();

    Object.keys(files).forEach((key) => {
      formData.append(key, files[key]);
    });

    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    
    const response = await fetch(url, { headers, method: "POST", body: formData });
    if (!response.ok) {
      throw new Error(response.status);
    }
    
    const data = await response.json();
    return data;
  }
);

export const testRequest = createAsyncThunk(
  "connection/testConnection",
  async ({ team_id, connection }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection.type}/test`;
    const body = JSON.stringify(connection);

    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    });

    const response = await fetch(url, { headers, method: "POST", body });

    const responseText = await response.text();
    let responseBody;
    try {
      responseBody = JSON.parse(responseText);
    } catch (e) {
      responseBody = responseText;
    }

    return { status: response.status, body: responseBody };
  }
);

export const testRequestWithFiles = createAsyncThunk(
  "connection/testConnectionWithFiles",
  async ({ team_id, connection, files }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection.type}/test/files`;
    const formData = new FormData();
    formData.append("connection", JSON.stringify(connection));
    
    // Add SSL certificate files if they exist
    if (files.sslCa) {
      formData.append("sslCa", files.sslCa);
    }
    if (files.sslCert) {
      formData.append("sslCert", files.sslCert);
    }
    if (files.sslKey) {
      formData.append("sslKey", files.sslKey);
    }
    
    // Add SSH private key file if it exists
    if (files.sshPrivateKey) {
      formData.append("sshPrivateKey", files.sshPrivateKey);
    }

    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });

    const response = await fetch(url, { headers, method: "POST", body: formData });

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = text;
    }

    return { status: response.status, body };
  }
);

export const removeConnection = createAsyncThunk(
  "connection/removeConnection",
  async ({ team_id, connection_id, removeDatasets }) => {
    const token = getAuthToken();
    let url = `${API_HOST}/team/${team_id}/connections/${connection_id}`;
    if (removeDatasets) url += "?removeDatasets=true";
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    const response = await fetch(url, { headers, method: "DELETE" });
    const data = await response.json();
    return data;
  }
);

export const runHelperMethod = createAsyncThunk(
  "connection/runHelperMethod",
  async ({ team_id, connection_id, methodName, params }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection_id}/helper/${methodName}`;
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    });
    const body = params ? JSON.stringify(params) : null;
    const response = await fetch(url, { headers, method: "POST", body });
    const data = await response.json();
    return data;
  }
);

export const duplicateConnection = createAsyncThunk(
  "connection/duplicateConnection",
  async ({ team_id, connection_id, name }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection_id}/duplicate`;
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
    const body = JSON.stringify({ name });
    const response = await fetch(url, { headers, method: "POST", body });
    if (!response.ok) {
      throw new Error(response.status);
    }

    const data = await response.json();
    return data;
  }
);

export const importConnections = createAsyncThunk(
  "connection/importConnections",
  async ({ team_id, source_team_id, connection_ids }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/import`;
    const headers = new Headers({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    });
    const body = JSON.stringify({ source_team_id, connection_ids });
    const response = await fetch(url, { headers, method: "POST", body });
    if (!response.ok) {
      throw new Error(response.statusText);
    }

    const data = await response.json();
    return data;
  }
);

export const getSharedConnections = createAsyncThunk(
  "connection/getSharedConnections",
  async ({ team_id } = {}) => {
    const token = getAuthToken();
    const qs = team_id ? `?team_id=${team_id}` : "";
    const url = `${API_HOST}/connection/shared${qs}`;
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    const response = await fetch(url, { headers, method: "GET" });
    if (!response.ok) throw new Error(response.statusText);
    return response.json();
  }
);

export const optInSharedConnection = createAsyncThunk(
  "connection/optInSharedConnection",
  async ({ team_id, connection_id }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection_id}/optin`;
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    const response = await fetch(url, { headers, method: "POST" });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || response.statusText);
    }
    return { team_id, connection_id };
  }
);

export const optOutSharedConnection = createAsyncThunk(
  "connection/optOutSharedConnection",
  async ({ team_id, connection_id }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection_id}/optin`;
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    const response = await fetch(url, { headers, method: "DELETE" });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || response.statusText);
    }
    return { team_id, connection_id };
  }
);

export const updateMongoSchema = createAsyncThunk(
  "connection/updateMongoSchema",
  async ({ team_id, connection_id }) => {
    const token = getAuthToken();
    const url = `${API_HOST}/team/${team_id}/connections/${connection_id}/update-schema`;
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    const response = await fetch(url, { headers, method: "POST" });
    if (!response.ok) {
      throw new Error(response.status);
    }

    const data = await response.json();
    return data;
  }
);

export const connectionSlice = createSlice({
  name: "dataset",
  initialState,
  reducers: {
    clearConnections: (state) => {
      state.data = [];
    },
  },
  extraReducers: (builder) => {
    // getTeamConnections
    builder.addCase(getTeamConnections.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(getTeamConnections.fulfilled, (state, action) => {
      state.loading = false;
      state.data = action.payload;
    })
    builder.addCase(getTeamConnections.rejected, (state) => {
      state.loading = false;
      state.error = true;
    })

    // getConnection
    builder.addCase(getConnection.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(getConnection.fulfilled, (state, action) => {
      state.loading = false;
      state.data = state.data.map((connection) => {
        if (connection.id === action.payload.id) {
          return action.payload;
        }
        return connection;
      });

      if (!state.data.find((connection) => connection.id === action.payload.id)) {
        state.data.push(action.payload);
      }
    })
    builder.addCase(getConnection.rejected, (state) => {
      state.loading = false;
      state.error = true;
    })

    // addConnection
    builder.addCase(addConnection.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(addConnection.fulfilled, (state, action) => {
      state.loading = false;
      state.data.push(action.payload);
    })
    builder.addCase(addConnection.rejected, (state) => {
      state.loading = false;
      state.error = true;
    })

    // saveConnection
    builder.addCase(saveConnection.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(saveConnection.fulfilled, (state, action) => {
      state.loading = false;
      state.data = state.data.map((connection) => {
        if (connection.id === action.payload.id) {
          return action.payload;
        }
        return connection;
      });
    })
    builder.addCase(saveConnection.rejected, (state) => {
      state.loading = false;
      state.error = true;
    })

    // testRequest
    builder.addCase(testRequest.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(testRequest.fulfilled, (state) => {
      state.loading = false;
    })
    builder.addCase(testRequest.rejected, (state) => {
      state.loading = false;
      state.error = true;
    })

    // testRequestWithFiles
    builder.addCase(testRequestWithFiles.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(testRequestWithFiles.fulfilled, (state) => {
      state.loading = false;
    })
    builder.addCase(testRequestWithFiles.rejected, (state) => {
      state.loading = false;
      state.error = true;
    })

    // removeConnection
    builder.addCase(removeConnection.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(removeConnection.fulfilled, (state, action) => {
      state.loading = false;
      state.data = state.data.filter((connection) => connection.id !== action.meta.arg.connection_id);
    })
    builder.addCase(removeConnection.rejected, (state) => {
      state.loading = false;
      state.error = true;
    })

    // runHelperMethod
    builder.addCase(runHelperMethod.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(runHelperMethod.fulfilled, (state) => {
      state.loading = false;
    })
    builder.addCase(runHelperMethod.rejected, (state) => {
      state.loading = false;
      state.error = true;
    });

    // duplicateConnection
    builder.addCase(duplicateConnection.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(duplicateConnection.fulfilled, (state, action) => {
      state.loading = false;
      state.data = [action.payload, ...state.data];
    })
    builder.addCase(duplicateConnection.rejected, (state) => {
      state.loading = false;
      state.error = true;
    });

    // importConnections
    builder.addCase(importConnections.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(importConnections.fulfilled, (state, action) => {
      state.loading = false;
      state.data = [...action.payload, ...state.data];
    })
    builder.addCase(importConnections.rejected, (state) => {
      state.loading = false;
      state.error = true;
    });

    // updateMongoSchema
    builder.addCase(updateMongoSchema.pending, (state) => {
      state.loading = true;
    })
    builder.addCase(updateMongoSchema.fulfilled, (state, action) => {
      state.loading = false;
      state.data = state.data.map((connection) => {
        if (connection.id === action.payload.id) {
          return action.payload;
        }
        return connection;
      });
    })
    builder.addCase(updateMongoSchema.rejected, (state) => {
      state.loading = false;
      state.error = true;
    });

    // getSharedConnections
    builder.addCase(getSharedConnections.pending, (state) => {
      state.sharedLoading = true;
    })
    builder.addCase(getSharedConnections.fulfilled, (state, action) => {
      state.sharedLoading = false;
      state.shared = action.payload;
    })
    builder.addCase(getSharedConnections.rejected, (state) => {
      state.sharedLoading = false;
    });

    // optInSharedConnection: flip isOptedIn locally so panel/badges update
    builder.addCase(optInSharedConnection.fulfilled, (state, action) => {
      const { team_id, connection_id } = action.payload;
      state.shared = state.shared.map((c) => {
        if (c.id !== connection_id) return c;
        const optedInTeamIds = Array.from(new Set([...(c.optedInTeamIds || []), Number(team_id)]));
        return { ...c, optedInTeamIds, isOptedIn: true };
      });
    });

    builder.addCase(optOutSharedConnection.fulfilled, (state, action) => {
      const { team_id, connection_id } = action.payload;
      state.shared = state.shared.map((c) => {
        if (c.id !== connection_id) return c;
        const optedInTeamIds = (c.optedInTeamIds || []).filter((id) => id !== Number(team_id));
        return { ...c, optedInTeamIds, isOptedIn: false };
      });
      state.data = state.data.filter((c) => c.id !== connection_id || c.team_id === Number(team_id));
    });
  },
});

export const { clearConnections } = connectionSlice.actions;

export const selectConnections = (state) => state.connection.data;
export const selectSharedConnections = (state) => state.connection.shared;
export const selectSharedConnectionsLoading = (state) => state.connection.sharedLoading;

export default connectionSlice.reducer;
