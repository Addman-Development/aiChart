import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Spacer,
} from "@heroui/react";
import { LuLock, LuShieldCheck } from "react-icons/lu";

import { changePassword, selectUser } from "../slices/user";
import { password as passwordValidation } from "../config/validations";

function ForcePasswordChange() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const user = useSelector(selectUser);
  const dispatch = useDispatch();

  const isOpen = user?.id && user?.mustChangePassword && !success;

  const _onSubmit = async (e) => {
    if (e) e.preventDefault();

    setError("");

    if (!temporaryPassword) {
      setError("Please enter your current temporary password");
      return;
    }

    const passwordError = passwordValidation(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (temporaryPassword === newPassword) {
      setError("New password must be different from the temporary password");
      return;
    }

    setLoading(true);
    try {
      const result = await dispatch(changePassword({
        user_id: user.id,
        currentPassword: temporaryPassword,
        newPassword,
      }));

      if (result.error) {
        throw new Error(result.error?.message || "Error changing password");
      }

      setSuccess(true);
      // Reload to refresh user state
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      if (err.message?.includes("401") || err.message?.includes("incorrect")) {
        setError("Current temporary password is incorrect");
      } else {
        setError(err.message || "Error changing password");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen && !success) return null;

  return (
    <Modal
      isOpen={isOpen || success}
      isDismissable={false}
      hideCloseButton
      size="md"
    >
      <ModalContent>
        {success ? (
          <>
            <ModalHeader className="flex flex-col items-center gap-2">
              <LuShieldCheck size={40} className="text-success" />
              <span>Password updated successfully</span>
            </ModalHeader>
            <ModalBody>
              <p className="text-center text-default-500">
                Redirecting you to the dashboard...
              </p>
            </ModalBody>
          </>
        ) : (
          <form onSubmit={_onSubmit}>
            <ModalHeader className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <LuLock size={20} />
                <span>Update your password</span>
              </div>
              <p className="text-sm font-normal text-default-500">
                Your account was created by an administrator. Please set a new password to continue.
              </p>
            </ModalHeader>
            <ModalBody>
              <Input
                label="Current temporary password"
                type="password"
                placeholder="Enter the temporary password you received"
                value={temporaryPassword}
                onChange={(e) => { setTemporaryPassword(e.target.value); setError(""); }}
                variant="bordered"
                startContent={<LuLock size={16} />}
              />
              <Spacer y={1} />
              <Input
                label="New password"
                type="password"
                placeholder="Enter your new password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                variant="bordered"
                startContent={<LuLock size={16} />}
              />
              <Spacer y={1} />
              <Input
                label="Confirm new password"
                type="password"
                placeholder="Re-enter your new password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                variant="bordered"
                startContent={<LuLock size={16} />}
              />
              {error && (
                <>
                  <Spacer y={1} />
                  <p className="text-danger text-sm">{error}</p>
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                color="primary"
                isLoading={loading}
                type="submit"
                fullWidth
              >
                Update password
              </Button>
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}

export default ForcePasswordChange;
