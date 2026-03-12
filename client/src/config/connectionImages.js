import mongoLogo from "../assets/mongodb-logo.png";
import postgresLogo from "../assets/postgres.png";
import apiLogo from "../assets/api.png";
import mongoDarkLogo from "../assets/mongodb-dark.png";
import postgresDarkLogo from "../assets/postgres-dark.png";
import apiDarkLogo from "../assets/api-dark.png";
import mssqlLogo from "../assets/sql-server-logo.png";

export default (isDark) => ({
  mongodb: isDark ? mongoDarkLogo : mongoLogo,
  postgres: isDark ? postgresDarkLogo : postgresLogo,
  api: isDark ? apiDarkLogo : apiLogo,
  mssql: mssqlLogo,
});
