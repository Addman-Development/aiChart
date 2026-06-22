import React from "react";
import PropTypes from "prop-types";
import {
  Card, CardBody, CardFooter, CardHeader, Divider, Link, Spacer,
} from "@heroui/react";
import { LuGraduationCap } from "react-icons/lu";

import Row from "./Row";

const bannerData = {
  api: {
    title: "Learn how to visualize your API data",
    description: "Connect to your API data and create charts that tell you more about your data.",
    url: "#",
    info: "5 min read",
  },
  mongodb: {
    title: "How to visualize your MongoDB data",
    description: "Connect to your MongoDB database and create charts that tell you more about your data.",
    url: "#",
    info: "7 min read",
  },
  postgres: {
    title: "How to visualize your Postgres data",
    description: "Connect to your Postgres database and create charts that tell you more about your data.",
    url: "#",
    info: "5 min read",
  },
  mssql: {
    title: "How to visualize your SQL Server data",
    description: "Connect to your SQL Server database and create charts that tell you more about your data.",
    url: "#",
    info: "5 min read",
  },
}

function HelpBanner(props) {
  const { type = "api", imageUrl } = props;

  const _onOpenHelp = () => {
    window.open(bannerData[type].url, "_blank");
  };

  if (!bannerData[type]) {
    return null;
  }

  return (
    <Card
      isPressable
      isHoverable
      onClick={() => _onOpenHelp()}
      className="max-w-[400px]"
      shadow="sm"
    >
      <CardHeader className="flex gap-3">
        <div>
          <img
            src={imageUrl}
            width={100}
            height={80}
            className="rounded-lg"
          />
        </div>
        <div>
          <Link
            className={"font-bold text-start"}
            href={bannerData[type].url}
            target="_blank"
            rel="noopener"
          >
            {bannerData[type].title}
          </Link>
        </div>
      </CardHeader>
      <Divider />
      <CardBody>
        <div className="text-sm">
          {bannerData[type].description}
        </div>
      </CardBody>
      <Divider />
      <CardFooter>
        <Row align="center">
          <LuGraduationCap size={24} />
          <Spacer x={1} />
          <div className="text-sm text-gray-500">
            {bannerData[type].info}
          </div>
        </Row>
      </CardFooter>
    </Card>
  );
}

HelpBanner.propTypes = {
  type: PropTypes.string,
  imageUrl: PropTypes.string.isRequired,
};

export default HelpBanner;
