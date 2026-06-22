module.exports = (user) => {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    icon: user.icon,
    active: user.active,
    admin: user.admin || false,
    tutorials: user.tutorials,
    createdAt: user.createdAt,
    User2fas: user.User2fas,
    PinnedDashboards: user.PinnedDashboards,
    mustChangePassword: user.mustChangePassword || false,
  };
};
