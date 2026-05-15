import React, { useEffect, useState } from "react";
import { connect, useDispatch } from "react-redux";
import PropTypes from "prop-types";
import { Link, useNavigate } from "react-router";
import {
  Card, CardBody, CardFooter, CardHeader, Spacer,
} from "@heroui/react";
import _ from "lodash";

import LoginForm from "../components/LoginForm";
import KeycloakLoginButton from "../components/KeycloakLoginButton";
import { cleanErrors as cleanErrorsAction } from "../actions/error";
import cbLogoSmall from "../assets/logo_inverted.png";
import Row from "../components/Row";
import Text from "../components/Text";
import { areThereAnyUsers, relog } from "../slices/user";
import { isKeycloakConfigured } from "../config/keycloakConfig";

/*
  Login container with an embedded login form
*/
function Login(props) {
  const { errors, cleanErrors } = props;
  const loginError = _.find(errors, { pathname: window.location.pathname });

  const navigate = useNavigate();
  const dispatch = useDispatch();
  const keycloakEnabled = isKeycloakConfigured();
  const [signupAllowed, setSignupAllowed] = useState(false);

  // Surface any SSO error that bounced the user back to the login page
  const params = new URLSearchParams(window.location.search);
  const ssoError = params.get("error");
  const ssoMessage = params.get("message");

  useEffect(() => {
    cleanErrors();

    dispatch(relog())
      .then((data) => {
        if (data?.payload?.id) {
          navigate("/");
        }
      });

    dispatch(areThereAnyUsers())
      .then((result) => {
        const hasUsers = result?.payload?.areThereAnyUsers;
        const restricted = result?.payload?.signupRestricted;
        setSignupAllowed(!hasUsers || !restricted);
      });
  }, []);

  return (
    <div className="pt-20">
      <Row justify="center" align="center">
        <Link to="/">
          <img size="tiny" src={cbLogoSmall} style={{ width: 70 }} alt="ADDMAN-SmartChart logo" />
        </Link>
      </Row>
      <Spacer y={4} />
      <div className="sm:flex m-4 justify-center">
        <Card shadow="none" className="border-1 border-divider">
          <CardHeader className={"flex justify-center"}>
            <h1 className={"mt-4 text-xl font-bold"}>{"Welcome back to ADDMAN-SmartChart"}</h1>
          </CardHeader>
          <CardBody>
            {keycloakEnabled && (
              <>
                <KeycloakLoginButton />
                <Spacer y={4} />
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-divider" />
                  <Text className="text-default-400 text-sm">Or sign in with email</Text>
                  <div className="flex-1 h-px bg-divider" />
                </div>
                <Spacer y={4} />
              </>
            )}
            {ssoError && (
              <>
                <div className="p-3 bg-danger-50 border border-danger-200 rounded-lg">
                  <Text className="text-danger text-sm">
                    {ssoMessage || "Single sign-on failed. Please try again."}
                  </Text>
                </div>
                <Spacer y={2} />
              </>
            )}
            <LoginForm />
          </CardBody>
          {loginError && (
            <CardFooter>
              <Row justify="center">
                <Text size="h4" color="danger">{loginError.message}</Text>
              </Row>
              <Row justify="center">
                <Text color="danger">{"Please try again."}</Text>
              </Row>
            </CardFooter>
          )}
        </Card>
      </div>
      {signupAllowed && (
        <>
          <Spacer y={8} />
          <Row justify="center" align="center">
            <div>
              <p>
                {" You don't have an account yet? "}
                <Link to={"/signup"} className="underline decoration-2">Sign up here</Link>
              </p>
            </div>
          </Row>
        </>
      )}
    </div>
  );
}

Login.propTypes = {
  errors: PropTypes.array.isRequired,
  cleanErrors: PropTypes.func.isRequired,
};

const mapStateToProps = (state) => {
  return {
    errors: state.error,
  };
};

const mapDispatchToProps = (dispatch) => {
  return {
    cleanErrors: () => dispatch(cleanErrorsAction()),
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(Login);
