import React from "react";
import {
  Image, Navbar, Link as LinkNext, NavbarBrand, NavbarContent, NavbarItem,
} from "@heroui/react";

import Text from "./Text";
import { useTheme } from "../modules/ThemeContext";
import cbLogoDark from "../assets/cb_logo_dark.svg";
import cbLogoLight from "../assets/cb_logo_light.svg";

function SimpleNavbar() {
  const { isDark } = useTheme();

  return (
    <Navbar maxWidth={"full"} className="z-50" isBordered>
      <NavbarBrand>
        <a href="https://aos.addmangroup.com/home">
          <Image src={isDark ? cbLogoDark : cbLogoLight} alt="Edison Logo" width={150} radius="sm" />
        </a>
      </NavbarBrand>
      <NavbarContent justify="flex-end">
        <NavbarItem>
          <LinkNext href="/login">
            <Text>Login</Text>
          </LinkNext>
        </NavbarItem>
        <NavbarItem>
          <LinkNext href="/signup">
            <Text>Sign Up</Text>
          </LinkNext>
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
}

export default SimpleNavbar;
