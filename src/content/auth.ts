export const authContent = {
  shared: {
    eyebrow: 'ONE ACCOUNT. YOUR WORKSPACE.',
    brandPrefix: 'Urban ',
    brandName: 'Tanker',
    homeAriaLabel: 'Back to Urban Tanker home',
    backToHome: 'Back to Urban Tanker',
    proof: 'Customer, vendor and admin experiences share one trusted delivery flow.',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    backToLogin: 'Back to login',
  },
  story: {
    signIn: {
      titleLead: 'Welcome ',
      titleEmphasis: 'back.',
      copy: 'Log in once and we will take you to the right place for your work with Urban Tanker.',
    },
    signUp: {
      titleLead: 'Start with ',
      titleEmphasis: 'Urban Tanker.',
      copy: 'Register to book and manage tanker services.',
    },
  },
  panel: {
    eyebrow: {
      signIn: 'SECURE SIGN IN',
      signUp: 'CREATE YOUR ACCOUNT',
    },
    title: {
      signIn: 'Open your workspace.',
      signUp: 'Create your account.',
      reset: 'Reset your password.',
    },
    intro: {
      signIn: 'Use your account credentials. Your role will route you automatically.',
      signUp: 'Register to book, track, and manage your services.',
      reset: 'We will send reset instructions if the account exists.',
    },
  },
  google: {
    button: 'Continue with Google',
    mark: 'G',
    note: 'Google sign-in is not connected.',
    divider: 'or use your username',
  },
  fields: {
    fullName: {
      label: 'Full name',
      placeholder: 'Enter your full name',
    },
    phone: {
      label: 'Phone number',
      placeholder: '10-digit mobile number',
    },
    accountType: {
      label: 'Account type',
      options: {
        customer: 'Customer',
        vendor: 'Vendor (needs approval)',
        admin: 'Admin (needs approval)',
      },
    },
    businessName: {
      label: 'Business name',
      placeholder: 'Your company or trading name',
    },
    serviceZone: {
      label: 'Service zone',
      placeholder: 'e.g. Koramangala, Bengaluru',
    },
    location: {
      label: 'Location (optional)',
      useCurrent: 'Use my current location',
      captured: 'Location captured',
      unavailable: 'Location is unavailable on this device.',
    },
    email: {
      label: 'Email',
      placeholder: 'you@example.com',
    },
    usernameOrEmail: {
      label: 'Username or email',
      placeholder: 'Enter your username or email',
    },
    password: {
      label: 'Password',
      placeholderSignUp: 'At least 8 characters',
      placeholderSignIn: 'Enter your password',
    },
  },
  actions: {
    createAccount: 'Create account',
    sendReset: 'Send reset instructions',
    logIn: 'Log in',
    forgotPassword: 'Forgot password?',
    createAnAccount: 'Create an account',
    newHere: 'New here?',
    alreadyHaveAccount: 'Already have an account?',
    separator: '·',
  },
  selfie: {
    title: 'Your photo (optional)',
    note: 'It is used to verify your account. It is stored privately, and only admins can view it.',
    previewAlt: 'Your selected photo',
    takeSelfie: 'Take selfie',
    capture: 'Take photo',
    cancelCamera: 'Cancel',
    cameraStarting: 'The camera is still starting. Try again in a moment.',
    cameraNotice: {
      'no-camera': 'No camera detected. Choose a photo from your device instead.',
      'permission-denied': 'Camera permission is off. Allow camera access in your browser settings, or choose a photo instead.',
      unsupported: 'This browser cannot open the camera. Choose a photo instead.',
      failed: 'The camera could not be opened. Choose a photo instead.',
    },
    choosePhoto: 'Choose photo',
    unusable: 'This photo could not be used. Try another photo.',
  },
  recovery: {
    story: {
      titleLead: 'Choose a ',
      titleEmphasis: 'new password.',
      copy: 'Set a new password to secure your Urban Tanker account.',
      proof: 'Choose a password with at least 8 characters.',
    },
    panel: {
      eyebrow: 'PASSWORD RECOVERY',
      title: 'Set a new password.',
      intro: 'Enter and confirm your new password below.',
    },
    fields: {
      newPassword: {
        label: 'New password',
        placeholder: 'At least 8 characters',
      },
      confirmPassword: {
        label: 'Confirm new password',
        placeholder: 'Re-enter your new password',
      },
    },
    submit: 'Update password',
  },
  messages: {
    incompleteSignUp: 'Complete all required account fields before continuing.',
    incompleteVendorSignUp: 'Enter your business name and service zone to create a vendor account.',
    accountCreatedAdminApproval: 'Account created. An existing admin must approve it before you can sign in.',
    accountCreatedConfirmEmail: 'Account created. Check your email and confirm your address before signing in.',
    accountCreatedFollowEmail: 'Account created. Follow the email instructions to finish registration.',
    accountCreatedNoRole: 'Your account was created but has no valid workspace role.',
    noWorkspaceRole: 'Your account has no valid workspace role.',
    enterEmailFirst: 'Enter your email address first.',
    resetRequested: 'If that account exists, reset instructions will be sent shortly.',
    passwordTooShort: 'Use a password with at least 8 characters.',
    passwordMismatch: 'The passwords do not match.',
    passwordUpdated: 'Your password has been updated. You can now sign in.',
    enterCredentials: 'Enter your username and password.',
    invalidCredentials: 'Username or password not recognised.',
    invalidResetLink: 'This password reset link is invalid or expired. Request a new one.',
    genericFailure: 'Unable to complete the request. Please try again.',
  },
} as const
