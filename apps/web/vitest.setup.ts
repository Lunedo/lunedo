import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

configure({ asyncUtilTimeout: 5000 });

afterEach(cleanup);
