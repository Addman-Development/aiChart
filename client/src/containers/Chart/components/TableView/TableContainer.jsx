import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Spacer, Tab, Tabs,
} from "@heroui/react";

import TableComponent from "./TableComponent";
import Row from "../../../../components/Row";
import Text from "../../../../components/Text";

function TableContainer(props) {
  const {
    tabularData, embedded = false, datasets,
    defaultRowsPerPage = 10,
    searchEnabled = true,
    filterEnabled = true,
    sortEnabled = true,
  } = props;

  const [activeDatasetIndex, setActiveDatasetIndex] = useState(0);
  const [totalValue, setTotalValue] = useState(0);

  useEffect(() => {
    if (datasets && datasets.length > 0) {
      setActiveDatasetIndex(0);
    }
  }, [datasets]);

  useEffect(() => {
    const activeDataset = datasets[activeDatasetIndex];
    const dataKey = Object.keys(tabularData)[activeDatasetIndex];

    if (activeDataset
      && tabularData[dataKey]?.data
      && activeDataset?.configuration?.sum
    ) {
      setTotalValue(0);
      tabularData[dataKey].data.forEach((d) => {
        if (d[activeDataset.configuration.sum]) {
          try {
            setTotalValue((prev) => prev + parseFloat(d[activeDataset.configuration.sum]));
          } catch (e) {
            // console.log("e", e);
          }
        }
      });
    }
  }, [activeDatasetIndex, tabularData]);

  const activeDataset = datasets[activeDatasetIndex];
  const dataKey = Object.keys(tabularData)[activeDatasetIndex];

  return (
    <div className="h-full flex flex-col min-h-0">
      <Row align="center" wrap="wrap" className={"gap-1 flex-none"}>
        {datasets.length > 1 && (
          <Tabs
            selectedKey={`${activeDatasetIndex}`}
            onSelectionChange={(key) => setActiveDatasetIndex(parseInt(key))}
            size="sm"
        >
          {datasets.map((dataset, index) => (
              <Tab key={index} title={dataset.legend} />
            ))}
          </Tabs>
        )}

        {activeDataset?.configuration?.sum && (
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
            <Text>{`Total ${activeDataset.configuration.sum}:`}</Text>
            <Spacer x={0.6} />
            <Text b>{totalValue?.toLocaleString()}</Text>
          </div>
        )}
      </Row>
      {dataKey && tabularData[dataKey] && tabularData[dataKey].columns && (
        <div className="flex-1 min-h-0 flex flex-col">
          <TableComponent
            columns={tabularData[dataKey].columns}
            data={tabularData[dataKey].data}
            embedded={embedded}
            dataset={activeDataset}
            defaultRowsPerPage={defaultRowsPerPage}
            searchEnabled={searchEnabled}
            filterEnabled={filterEnabled}
            sortEnabled={sortEnabled}
          />
        </div>
      )}
    </div>
  );
}

TableContainer.propTypes = {
  tabularData: PropTypes.object.isRequired,
  datasets: PropTypes.array.isRequired,
  embedded: PropTypes.bool,
  defaultRowsPerPage: PropTypes.number,
  searchEnabled: PropTypes.bool,
  filterEnabled: PropTypes.bool,
  sortEnabled: PropTypes.bool,
};

export default TableContainer;
