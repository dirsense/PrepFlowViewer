# Synthetic Tableau Server connection sample

`Demo_Tableau_Server_Connections.tflx` was created for PrepFlow Viewer to test connection information without contacting a real server.

| Server | Project | Data source | Input steps |
| --- | --- | --- | --- |
| https://analytics.example.invalid | Sales Analytics | Sales Detail | Domestic Sales, International Sales |
| https://analytics.example.invalid | Customer Management | Customer Master | Customers |
| https://analytics.example.invalid | Business Planning | Monthly Budget | Monthly Budget |
| https://reference.example.invalid | Shared Masters | Store Master | Stores |

Open the flow, clear the step selection and choose Connections in the overview. Expand a server to see its input steps. Select a step's connection settings to inspect server, site, project, data source and owner.

The first server has four inputs; the second has one. Domestic and International Sales share one connection definition. Each input leads to a simple cleaning step. The sites are Default and Reference; owner names such as `demo_sales` are fictitious.

The file contains no credentials or real data. The reserved `.invalid` domains do not refer to live servers. The Viewer reads the definition without connecting. Opening/running this synthetic flow in Tableau Prep Builder and publishing it to Server are not supported test scenarios.
